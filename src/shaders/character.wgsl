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
  // The light probe round the camera (the ship's: trace.wgsl env, ship.wgsl envSH): the camera's axes in its axes.
  // probeX.w: on (fresh this frame); probeY.w: its GGX mips − 1; probeZ.w: unused.
  probeX:vec4f, probeY:vec4f, probeZ:vec4f,
  // The vessel's shadow map: its bounding sphere in the camera's axes [m] (w: radius; 0: none) — trace.wgsl shipShadow.
  shipBound:vec4f,
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
// The probe: 9 × rgb harmonics, the dominant direction, the key light's direction and its irradiance (ship.wgsl envSH).
@group(0) @binding(9) var<storage,read> sh:array<vec4f>;
@group(0) @binding(10) var envTex:texture_2d<f32>;
@group(0) @binding(11) var envSamp:sampler;
@group(0) @binding(12) var shipShadowMap:texture_depth_2d;
const PI=3.14159265358979;

fn probeOn()->bool{return u.probeX.w>.5;}
fn toProbe(v:vec3f)->vec3f{return v.x*u.probeX.xyz+v.y*u.probeY.xyz+v.z*u.probeZ.xyz;}
fn fromProbe(d:vec3f)->vec3f{return vec3f(dot(d,u.probeX.xyz),dot(d,u.probeY.xyz),dot(d,u.probeZ.xyz));}
fn shBasis(d:vec3f)->array<f32,9>{
 return array<f32,9>(.282095,.488603*d.y,.488603*d.z,.488603*d.x,1.092548*d.x*d.y,1.092548*d.y*d.z,.315392*(3*d.z*d.z-1),1.092548*d.x*d.z,.546274*(d.x*d.x-d.y*d.y));
}
// The light falling on a surface facing n (camera axes) from everything but the key light: the probe's
// harmonics (Ramamoorthi & Hanrahan), as the ship's hull receives it; without the probe, the sky estimate.
fn ambientIrradiance(n:vec3f)->vec3f{
 if(!probeOn()){return PI*u.sky.xyz*(.4+.6*max(dot(n,u.up.xyz),0));}
 let b=shBasis(toProbe(n));let A=array<f32,9>(PI,2.094395,2.094395,2.094395,.785398,.785398,.785398,.785398,.785398);
 var e=vec3f(0);for(var k=0u;k<9u;k++){e+=A[k]*b[k]*sh[k].rgb;}
 return max(e,vec3f(0));
}
// The key light's irradiance (the near world's star through its air, its horizon and its relief): the probe's,
// the same the ship receives; with the probe on and no key, its light is in the harmonics already.
fn keyIrradiance()->vec3f{
 if(!probeOn()){return u.irradiance.xyz;}
 return select(vec3f(0),max(sh[11].rgb,vec3f(0)),sh[11].w>.5);
}
fn envUV(d:vec3f)->vec2f{return vec2f(atan2(d.x,d.z)/(2*PI)+.5,acos(clamp(d.y,-1.0,1.0))/PI);}
// The surroundings reflected (GGX pre-filtered), else the sky estimate brighter above the horizon.
fn envSpecular(r:vec3f,rough:f32)->vec3f{
 if(!probeOn()){return u.sky.xyz*(.2+1.8*smoothstep(-.05,.25,dot(r,u.up.xyz)));}
 return textureSampleLevel(envTex,envSamp,envUV(toProbe(r)),rough*u.probeY.w).rgb;
}
// Split-sum environment BRDF, scale and bias (Karis 2014, analytic fit): F0·x + y.
fn envAB(rough:f32,nv:f32)->vec2f{
 let r=rough*vec4f(-1,-.0275,-.572,.022)+vec4f(1,.0425,1.04,-.04);
 let a=min(r.x*r.x,exp2(-9.28*nv))*r.x+r.y;return vec2f(-1.04,1.04)*a+r.zw;
}
// The vessel's shadow at p (camera axes): its own shadow map, seen from the probe's dominant light (ship.wgsl lightClip).
fn shipShadowAt(p:vec3f)->f32{
 let R=u.shipBound.w;if(R<=0||!probeOn()){return 1;}
 let dl=sh[9].xyz;if(dot(dl,dl)<1e-12){return 1;}
 let l=normalize(fromProbe(dl));
 let e1=normalize(cross(l,select(vec3f(0,1,0),vec3f(1,0,0),abs(l.y)>.9)));let e2=cross(l,e1);
 let q=p-u.shipBound.xyz;let c=vec3f(dot(q,e1)/R,dot(q,e2)/R,.5-.5*dot(q,l)/R);
 if(abs(c.x)>=1||abs(c.y)>=1){return 1;}
 let dims=vec2i(textureDimensions(shipShadowMap));let px=vec2i(vec2f(.5+.5*c.x,.5-.5*c.y)*vec2f(dims));
 var lit=0.0;
 for(var j=-1;j<=1;j++){for(var i=-1;i<=1;i++){let d=textureLoad(shipShadowMap,clamp(px+vec2i(i,j),vec2i(0),dims-1),0);lit+=select(0.0,1.0,d>=.9999||c.z<=d+.004);}}
 return lit/9;
}

fn orient(v:vec3f)->vec3f {return u.right.xyz*v.x+u.up.xyz*v.y+u.forward.xyz*v.z;}
fn grassCam(v:vec3f)->vec3f {return u.grassOrigin.xyz+u.grassRight.xyz*v.x+u.grassUp.xyz*v.y+u.grassForward.xyz*v.z;}
fn project(q:vec3f)->vec4f{return vec4f(q.x/u.view.x,q.y/u.view.y,0.035,q.z);}
fn lightClip(q:vec3f)->vec3f {
 let l=normalize(u.sun.xyz);let x=normalize(cross(l,select(vec3f(0,1,0),vec3f(1,0,0),abs(l.y)>.9)));let y=cross(l,x);
 let d=q-u.origin.xyz-u.up.xyz*.85;return vec3f(dot(d,x)/3.5,dot(d,y)/3.5,.5-dot(d,l)/7.0);
}
fn shadowAt(q:vec3f,n:vec3f)->f32 {
 let c=lightClip(q+n*.009+u.sun.xyz*.004);let uv=vec2f(c.x*.5+.5,.5-c.y*.5);
 // (a receiver beyond the map's depth — the far end of a long evening shadow — is behind every occluder: its
 // depth held at the far plane, so the astronaut's whole shadow falls, not only its first 3.5 m)
 if(any(uv<vec2f(0))||any(uv>vec2f(1))||c.z<0){return 1;}
 let z=min(c.z,.998);
 var value=0.0;
 for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){value+=textureSampleCompareLevel(shadow,compare,uv+vec2f(f32(x),f32(y))/512.0,z-.001);}}
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
 let lod=select(select(0u,1u,d>6),2u,d>16);let at=atomicAdd(&commands[lod].instances,1u);let tip=p+u.grassUp.xyz*.2;let shade=u32(nearSceneryShadow(tip)*shipShadowAt(tip)*255);culled[lod*65536u+at]=id.x|(shade<<16u);
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
// The colour, and for the vessel drawn after: the distance [m] × coverage and the coverage (ship.wgsl: its occluder).
// (the occluder's alpha: the grass's blending reads it — the rg16float target keeps red and green)
struct Out { @location(0) color:vec4f, @location(1) occluder:vec4f };
@fragment fn fs(v:V,@builtin(front_facing) front:bool)->Out {
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
 let L=normalize(u.sun.xyz);let nl=max(dot(n,L),0);var vis=shadowAt(v.p,n);if(v.material>9){vis*=v.local.z;}else{vis*=nearSceneryShadow(v.p)*shipShadowAt(v.p);}
 let Ek=keyIrradiance();
 let diffuse=color/PI;var direct=(diffuse*nl+ggx(n,eye,L,rough,f0)*nl)*Ek*vis;
 // (a blade lit from behind: the light through its leaf)
 if(v.material>9){direct+=color*Ek*.22*pow(max(dot(eye,-L),0),3)*vis*(.4+.6*v.local.y);}
 let ao=select(1.0,mix(.45,1.0,v.local.y),v.material>9);
 let coverage=select(1.0,edgeCoverage*v.coverage,v.material>9);
 let F=f0+(vec3f(1)-f0)*pow(1-max(dot(n,eye),0),5);
 let ambient=diffuse*(vec3f(1)-F)*ambientIrradiance(n)*ao+envSpecular(reflect(-eye,n),rough)*F*ao;
 var o:Out;o.color=vec4f((direct+ambient)*u.image.w*coverage,coverage);o.occluder=vec4f(length(v.p)*coverage,coverage,0,coverage);return o;
}
@vertex fn screenVs(@builtin(vertex_index) k:u32)->@builtin(position) vec4f {let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));return vec4f(p[k],0,1);}
// The astronaut's shadow and contact occlusion on what the tracer drew: the traced light is the key's
// (Ek cos θ, where nothing else shadows it already) and the ambient's (the probe's irradiance from above);
// the shadow takes the key's share away, the contact a part of the ambient's under the feet — the same
// physics on the Earth (a soft shadow under a blue sky), the Moon (black: no air) or under clouds (faint).
@fragment fn groundShadow(@builtin(position) pixel:vec4f)->@location(0) vec4f {
 let at=u32(pixel.y)*u32(u.image.x)+u32(pixel.x);let distance=moments[at].y*u.image.z;
 if(distance<=0||distance>35){return vec4f(1);}
 let ndc=vec2f(pixel.x/u.image.x*2-1,1-pixel.y/u.image.y*2);let p=normalize(vec3f(ndc* u.view.xy,1))*distance;
 let delta=p-u.origin.xyz;let h=dot(delta,u.up.xyz);let r=length(delta-u.up.xyz*h);
 let contact=.6*exp(-(r*r)/.09)*(1-smoothstep(.05,.45,abs(h)));
 let s=shadowAt(p,u.up.xyz);
 if(s>=.999&&contact<.003){return vec4f(1);}
 let L=normalize(u.sun.xyz);let cosine=max(dot(u.up.xyz,L),0);
 // (already in a tree's, a building's or the vessel's shadow: no key light left to take away)
 var lit=1.0;if(s<.999){lit=nearSceneryShadow(p)*shipShadowAt(p);}
 let lum=vec3f(.2126,.7152,.0722);
 let key=dot(keyIrradiance(),lum)*cosine*lit;let sky=dot(ambientIrradiance(u.up.xyz),lum);
 let total=key+sky;if(total<=0){return vec4f(1);}
 return vec4f(vec3f(clamp((key*s+sky*(1-contact))/total,0.0,1.0)),1);
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
@fragment fn skinFs(v:SkinV,@builtin(front_facing) front:bool)->Out{
 let ip=vec2u(v.clip.xy);let at=min(ip.y,u32(u.image.y)-1u)*u32(u.image.x)+min(ip.x,u32(u.image.x)-1u);
 if(moments[at].y*u.image.z<length(v.p)-.025){discard;}
 let layer=select(4i,0i,v.material==0u);
 let color=pow(textureSample(materialMaps,materialSampler,v.uv,layer).rgb,vec3f(2.2));
 let metal=textureSample(materialMaps,materialSampler,v.uv,layer+1).r;
 let ao=textureSample(materialMaps,materialSampler,v.uv,layer+2).r;
 let mapped=textureSample(materialMaps,materialSampler,v.uv,layer+3).xyz*2-1;
 let base=normalize(v.n);let T=normalize(v.tangent.xyz-base*dot(base,v.tangent.xyz));let B=cross(base,T)*v.tangent.w;
 var N=normalize(T*mapped.x+B*mapped.y+base*mapped.z);let V=normalize(-v.p);if(dot(N,V)<0){N=-N;}
 let L=normalize(u.sun.xyz);let visibility=shadowAt(v.p,N)*nearSceneryShadow(v.p)*shipShadowAt(v.p);let nl=max(dot(N,L),0);
 let rough=select(clamp(1-metal,.14,.92),.08,v.material==2u);let f0=select(mix(vec3f(.04),color,metal),vec3f(.11),v.material==2u);
 let nv=clamp(dot(N,V),1e-4,1.0);
 let F=f0+(vec3f(1)-f0)*pow(1-nv,5);
 let diffuse=color*(1-metal)*(vec3f(1)-F)/PI;
 let direct=(diffuse*nl+ggx(N,V,L,rough,f0)*nl)*keyIrradiance()*visibility;
 // (the surroundings: the probe's irradiance on the suit, its pre-filtered image in the visor and the metal —
 // the split sum's scale and bias, the specular occluded with the cavities, Lagarde)
 let ab=envAB(rough,nv);let so=clamp(pow(nv+ao,exp2(-16*rough-1))-1+ao,0.0,1.0);
 let ambient=diffuse*ambientIrradiance(N)*ao+envSpecular(reflect(-V,N),rough)*(f0*ab.x+ab.y)*so;
 var o:Out;o.color=vec4f((direct+ambient)*u.image.w,1);o.occluder=vec4f(length(v.p),1,0,1);return o;
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
