// Native near-ground pass: camera-relative metres, HDR, solar PBR, procedural suit and grass.
struct U {
  // view.zw: the grass lattice's offset (metres along right and forward) — the wind is read from it, so a blade's gust does not jump when the patch recentres.
  view:vec4f, image:vec4f, origin:vec4f,
  right:vec4f, up:vec4f, forward:vec4f,
  sun:vec4f, irradiance:vec4f, sky:vec4f,
  grassOrigin:vec4f, grassRight:vec4f, grassUp:vec4f, grassForward:vec4f,
  // Each ellipsoid: centre/material; radii/hinge angle. Joints animate on the GPU.
  parts:array<vec4f,64>,
  scene:array<vec4f,6>,
  // tune: the grass's reach [m], its sway (1 as authored), the share of blades drawn (the renderer's settings).
  tune:vec4f,
};
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> moments:array<vec2f>;
@group(0) @binding(2) var<storage,read> roots:array<vec4f>;
@group(0) @binding(3) var<storage,read> visible:array<u32>;
struct Command {vertices:u32, instances:atomic<u32>, first:u32, base:u32};
@group(0) @binding(4) var<storage,read_write> commands:array<Command>;
@group(0) @binding(7) var<storage,read_write> culled:array<u32>;
@group(0) @binding(5) var shadow:texture_depth_2d;
@group(0) @binding(6) var compare:sampler_comparison;

fn orient(v:vec3f)->vec3f {return u.right.xyz*v.x+u.up.xyz*v.y+u.forward.xyz*v.z;}
fn grassCam(v:vec3f)->vec3f {return u.grassOrigin.xyz+u.grassRight.xyz*v.x+u.grassUp.xyz*v.y+u.grassForward.xyz*v.z;}
fn project(q:vec3f)->vec4f{return vec4f(q.x/u.view.x,q.y/u.view.y,0.035,q.z);}
fn lightClip(q:vec3f)->vec3f {
 let l=normalize(u.sun.xyz);let x=normalize(cross(l,select(vec3f(0,1,0),vec3f(1,0,0),abs(l.y)>.9)));let y=cross(l,x);
 let d=q-u.origin.xyz-u.up.xyz*.85;return vec3f(dot(d,x)/3.5,dot(d,y)/3.5,.5-dot(d,l)/7.0);
}
fn shadowAt(q:vec3f,n:vec3f)->f32 {
 let c=lightClip(q+n*.009+u.sun.xyz*.004);let uv=vec2f(c.x*.5+.5,.5-c.y*.5);
 if(any(uv<vec2f(0))||any(uv>vec2f(1))||c.z<0||c.z>1){return 1;}
 var value=0.0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){value+=textureSampleCompareLevel(shadow,compare,uv+vec2f(f32(x),f32(y))/512.0,c.z-.001);}}
 return value/9;
}
fn rotateX(v:vec3f,a:f32)->vec3f{return vec3f(v.x,cos(a)*v.y-sin(a)*v.z,sin(a)*v.y+cos(a)*v.z);}
struct V { @builtin(position) clip:vec4f, @location(0) p:vec3f, @location(1) n:vec3f, @location(2) local:vec3f, @location(3) @interpolate(flat) material:f32, @location(4) tint:vec3f, @location(5) coverage:f32 };
fn avatarVertex(p:vec3f,k:u32)->V {
 let a=u.parts[k*2u];let b=u.parts[k*2u+1u];
 var angle=b.w;
 // The limb pivots swing in opposite phase. Knees flex on the returning step.
 if(k>=8u&&k<16u){let side=select(1.0,-1.0,(k%2u)==1u);angle+=sin(u.origin.w+side*1.570796)*u.right.w*select(.32,.65,k<12u);}
 let q=a.xyz+rotateX(p*b.xyz,angle);var o:V;
 o.p=u.origin.xyz+orient(q);o.n=normalize(orient(rotateX(p/b.xyz,angle)));o.local=q;o.material=a.w;o.tint=vec3f(1);o.coverage=1;o.clip=project(o.p);return o;
}
@vertex fn avatarVs(@location(0) p:vec3f,@builtin(instance_index) k:u32)->V{return avatarVertex(p,k);}
@vertex fn shadowVs(@location(0) p:vec3f,@builtin(instance_index) k:u32)->@builtin(position) vec4f{return vec4f(lightClip(avatarVertex(p,k).p),1);}

@compute @workgroup_size(128) fn cull(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=u32(u.grassOrigin.w)){return;}let r=roots[id.x];let p=grassCam(r.xyz);let delta=p-u.origin.xyz;let d=length(delta-u.up.xyz*dot(delta,u.up.xyz));
 if(d>u.tune.x||p.z<.03||abs(p.x)>p.z*u.view.x+.6||abs(p.y)>p.z*u.view.y+.8){return;}
 let lod=select(select(0u,1u,d>6),2u,d>16);let at=atomicAdd(&commands[lod].instances,1u);let shade=u32(nearSceneryShadow(p+u.grassUp.xyz*.2)*255);culled[lod*65536u+at]=id.x|(shade<<16u);
}
@vertex fn grassVs(@builtin(vertex_index) v:u32,@builtin(instance_index) instance:u32)->V{
 let lod=u32(u.forward.w);let segments=select(select(6u,2u,lod==1u),1u,lod==2u);
 let corners=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));
 let c=corners[v%6u];let t=(f32(v/6u)+c.x)/f32(segments);let entry=visible[lod*65536u+instance];let r=roots[entry&65535u];
 let angle=r.w*6.283185;let h=.19+.25*fract(r.w*17.319);let width=(.008+.006*fract(r.w*71.79))*(1-t);
 let root=grassCam(r.xyz);let pixelWidth=max(root.z,.035)*u.view.y/u.image.y;let rasterWidth=max(width,pixelWidth*.7*(1-t));let side=u.grassRight.xyz*cos(angle)+u.grassForward.xyz*sin(angle);
 let g=r.xz+u.view.zw;let wind=(sin(dot(g,vec2f(.37,.21))+u.up.w*1.7)+.4*sin(dot(g,vec2f(.13,-.33))+u.up.w*2.3))*u.tune.y;
 let delta=root-u.origin.xyz;let dist=length(delta-u.up.xyz*dot(delta,u.up.xyz));let push=normalize(delta+vec3f(.001));let influence=1-smoothstep(.15,.9,dist);
 let bend=(u.grassRight.xyz*.06*wind+u.grassForward.xyz*.045*wind+push*.35*influence)*t*t;
 var o:V;o.p=root+u.grassUp.xyz*h*t+side*(c.y*rasterWidth)+bend;o.n=normalize(cross(side,u.grassUp.xyz+bend*2));o.local=vec3f(c.y,t,f32(entry>>16u)/255);o.material=10;o.coverage=min(1.0,width/max(rasterWidth,1e-6))*(1-smoothstep(u.tune.x-3.0,u.tune.x,dist));o.tint=mix(vec3f(.018,.055,.009),vec3f(.075,.19,.018),t)*(.7+.6*fract(r.w*37.71));o.clip=project(o.p);return o;
}
fn ggx(N:vec3f,V:vec3f,L:vec3f,rough:f32,f0:vec3f)->vec3f{
 let H=normalize(V+L);let nh=max(dot(N,H),0);let nv=max(dot(N,V),.001);let nl=max(dot(N,L),.001);let a=rough*rough;let aa=a*a;let d=nh*nh*(aa-1)+1;
 let D=aa/(3.141592*d*d);let G=.5/max(nl*sqrt(nv*nv*(1-aa)+aa)+nv*sqrt(nl*nl*(1-aa)+aa),.0001);
 return D*G*(f0+(vec3f(1)-f0)*pow(1-max(dot(V,H),0),5));
}
@fragment fn fs(v:V,@builtin(front_facing) front:bool)->@location(0) vec4f {
 let edgeWidth=max(fwidth(v.local.x),.001);let edgeCoverage=1-smoothstep(1-edgeWidth,1+edgeWidth,abs(v.local.x));
 let pixel=vec2u(v.clip.xy);let at=min(pixel.y,u32(u.image.y)-1u)*u32(u.image.x)+min(pixel.x,u32(u.image.x)-1u);
 if(moments[at].y*u.image.z<length(v.p)-.025){discard;}
 let eye=normalize(-v.p);var n=normalize(v.n);if(dot(n,eye)<0){n=-n;}
 var color=vec3f(.56,.6,.62);var rough=.8;var f0=vec3f(.04);
 if(v.material<.5){ // Woven pressure suit: subtle seam courses and microfabric.
  let seam=1-smoothstep(.02,.04,abs(fract(v.local.y*11)-.5));color*=1-.14*seam;
  color*=.94+.06*sin(v.local.x*680)*sin(v.local.y*540);rough=.85;
 }else if(v.material<1.5){color=vec3f(.015,.018,.023);rough=.65;}
 else if(v.material<2.5){color=vec3f(.32,.12,.025);f0=vec3f(.7,.5,.19);rough=.12;}
 else if(v.material<3.5){color=vec3f(.25,.037,.012);rough=.7;}
 else if(v.material<4.5){color=vec3f(.21,.23,.25);rough=.3;f0=vec3f(.35);}
 else {color=v.tint;rough=.9;}
 let L=normalize(u.sun.xyz);let nl=max(dot(n,L),0);var vis=shadowAt(v.p,n);if(v.material>9){vis*=v.local.z;}else{vis*=nearSceneryShadow(v.p);}
 let sky=u.sky.xyz*(.4+.6*max(dot(n,u.up.xyz),0));
 let diffuse=color/3.141592;var direct=(diffuse*nl+ggx(n,eye,L,rough,f0)*nl)*u.irradiance.xyz*vis;
 if(v.material>9){direct+=color*u.irradiance.xyz*.22*pow(max(dot(eye,-L),0),3)*vis*(.4+.6*v.local.y);}
 let ao=select(1.0,mix(.45,1.0,v.local.y),v.material>9);
 let coverage=select(1.0,edgeCoverage*v.coverage,v.material>9);
 return vec4f((direct+color*sky*ao)*u.image.w*coverage,coverage);
}
@vertex fn screenVs(@builtin(vertex_index) k:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[k],0,1);}
@fragment fn groundShadow(@builtin(position) pixel:vec4f)->@location(0) vec4f {
 let at=u32(pixel.y)*u32(u.image.x)+u32(pixel.x);let distance=moments[at].y*u.image.z;
 if(distance<=0||distance>35){return vec4f(1);}
 let ndc=vec2f(pixel.x/u.image.x*2-1,1-pixel.y/u.image.y*2);let p=normalize(vec3f(ndc* u.view.xy,1))*distance;
 let s=shadowAt(p,u.up.xyz);let daylight=smoothstep(-.01,.12,dot(u.up.xyz,u.sun.xyz));
 return vec4f(vec3f(1-(1-s)*daylight*.68),1);
}

// Imported astronaut: native GPU skinning, authored PBR maps in an eight-layer texture array.
@group(1) @binding(0) var<storage,read> bones:array<mat4x4f>;
@group(1) @binding(1) var materialSampler:sampler;
@group(1) @binding(2) var materialMaps:texture_2d_array<f32>;
struct SkinIn { @location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,@location(3) joints:vec4u,@location(4) weights:vec4f,@location(5) tangent:vec4f,@location(6) material:u32 };
struct SkinV { @builtin(position) clip:vec4f,@location(0) p:vec3f,@location(1) n:vec3f,@location(2) uv:vec2f,@location(3) @interpolate(flat) material:u32,@location(4) tangent:vec4f };
fn skin(v:SkinIn)->SkinV{
 let m=bones[v.joints.x]*v.weights.x+bones[v.joints.y]*v.weights.y+bones[v.joints.z]*v.weights.z+bones[v.joints.w]*v.weights.w;
 let q=(m*vec4f(v.p,1)).xyz;let n=(m*vec4f(v.n,0)).xyz;let t=(m*vec4f(v.tangent.xyz,0)).xyz;
 var o:SkinV;o.p=u.origin.xyz+orient(q);o.n=normalize(orient(n));o.tangent=vec4f(normalize(orient(t)),v.tangent.w);o.uv=v.uv;o.material=v.material;o.clip=project(o.p);return o;
}
@vertex fn skinVs(v:SkinIn)->SkinV{return skin(v);}
@vertex fn skinShadowVs(v:SkinIn)->@builtin(position) vec4f {return vec4f(lightClip(skin(v).p),1);}
@fragment fn skinFs(v:SkinV,@builtin(front_facing) front:bool)->@location(0) vec4f{
 let ip=vec2u(v.clip.xy);let at=min(ip.y,u32(u.image.y)-1u)*u32(u.image.x)+min(ip.x,u32(u.image.x)-1u);
 if(moments[at].y*u.image.z<length(v.p)-.025){discard;}
 let layer=select(4i,0i,v.material==0u);
 let color=pow(textureSample(materialMaps,materialSampler,v.uv,layer).rgb,vec3f(2.2));
 let metal=textureSample(materialMaps,materialSampler,v.uv,layer+1).r;
 let ao=textureSample(materialMaps,materialSampler,v.uv,layer+2).r;
 let mapped=textureSample(materialMaps,materialSampler,v.uv,layer+3).xyz*2-1;
 let base=normalize(v.n);let T=normalize(v.tangent.xyz-base*dot(base,v.tangent.xyz));let B=cross(base,T)*v.tangent.w;
 var N=normalize(T*mapped.x+B*mapped.y+base*mapped.z);let V=normalize(-v.p);if(dot(N,V)<0){N=-N;}
 let L=normalize(u.sun.xyz);let visibility=shadowAt(v.p,N)*nearSceneryShadow(v.p);let nl=max(dot(N,L),0);
 let rough=select(clamp(1-metal,.14,.92),.08,v.material==2u);let f0=select(mix(vec3f(.04),color,metal),vec3f(.11),v.material==2u);
 let sky=u.sky.xyz*(.4+.6*max(dot(N,u.up.xyz),0));
 let F=f0+(vec3f(1)-f0)*pow(1-max(dot(N,V),0),5);
 let diffuse=color*(1-metal)*(vec3f(1)-F)/3.141592;
 let direct=(diffuse*nl+ggx(N,V,L,rough,f0)*nl)*u.irradiance.xyz*visibility;
 let R=reflect(-V,N);let skyReflect=u.sky.xyz*(.2+1.8*smoothstep(-.05,.25,dot(R,u.up.xyz)));
 let ambient=color*(1-metal)*sky*ao+skyReflect*F*ao;
 return vec4f((direct+ambient)*u.image.w,1);
}

// Same packed OSM/WorldCover BVH as the planet renderer: direct sunlight at each near-field fragment.
@group(0) @binding(8) var<storage,read> nearScene:array<vec4f>;
fn nearSceneryShadow(q:vec3f)->f32 {
 if(u.scene[2].w<.5){return 1;}
 let delta=q-u.origin.xyz;
 let o=u.scene[3].xyz+vec3f(dot(u.scene[0].xyz,delta),dot(u.scene[1].xyz,delta),dot(u.scene[2].xyz,delta));
 let d=normalize(vec3f(dot(u.scene[0].xyz,u.sun.xyz),dot(u.scene[1].xyz,u.sun.xyz),dot(u.scene[2].xyz,u.sun.xyz)));
 let origin=o+d*.025;let inv=1/select(d,vec3f(1e-8),abs(d)<vec3f(1e-8));let total=u32(nearScene[0].x);var i=0u;
 while(i<total){
  let lo=nearScene[4u+2u*i];let hi=nearScene[5u+2u*i];let a=(lo.xyz-origin)*inv;let b=(hi.xyz-origin)*inv;
  let low=min(a,b);let high=max(a,b);let enter=max(max(low.x,low.y),low.z);let leave=min(min(high.x,high.y),high.z);
  if(leave<max(enter,0)||enter>500){i=u32(lo.w);continue;}
  if(hi.w<0){i++;continue;}
  let base=u32(nearScene[0].y+hi.w);let p=nearScene[base];let size=nearScene[base+1u];
  if(p.w<.5){
   for(var l=0u;l<5u;l++){
    let phase=f32(l)*2.399963+size.z*6.283185;let reach=select(size.x*.38,0.0,l==0u);
    let center=p.xyz+vec3f(cos(phase)*reach,sin(phase)*reach,size.y*(.6+.06*f32(l)));
    let r=vec3f(size.x*(.65+.06*f32(l%3u)),size.x*(.65+.06*f32(l%3u)),size.y*(.22+.02*f32(l%3u)));
    let op=(origin-center)/r;let dr=d/r;let aa=dot(dr,dr);let bb=dot(op,dr);let determinant=bb*bb-aa*(dot(op,op)-1);
    if(determinant>=0){let t=(-bb-sqrt(determinant))/aa;if(t>.01&&t<500){return 0;}}
   }
  }else{
   let count=u32(p.z);
   for(var e=0u;e<count;e++){
    let edge=nearScene[base+3u+e];let v=edge.zw-edge.xy;let den=d.x*v.y-d.y*v.x;if(abs(den)<1e-7){continue;}
    let r=edge.xy-origin.xy;let t=(r.x*v.y-r.y*v.x)/den;let f=(r.x*d.y-r.y*d.x)/den;let z=origin.z+d.z*t;
    if(t>.01&&t<500&&f>=0&&f<=1&&z>=p.x&&z<=p.y){return 0;}
   }
   if(abs(d.z)>1e-7){for(var cap=0u;cap<2u;cap++){let z=select(p.x,p.y,cap==1u);let t=(z-origin.z)/d.z;if(t<=.01||t>=500){continue;}let point=(origin+d*t).xy;var inside=false;for(var e=0u;e<count;e++){let edge=nearScene[base+3u+e];if((edge.y>point.y)!=(edge.w>point.y)){if(point.x<edge.x+(point.y-edge.y)*(edge.z-edge.x)/(edge.w-edge.y)){inside=!inside;}}}if(inside){return 0;}}}
  }
  i++;
 }
 return 1;
}
