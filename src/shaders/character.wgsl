// Native near-ground pass: camera-relative metres, HDR, solar PBR, the astronaut and the living ground.
struct U {
  // view.xy: the projection's tangents; image: its size [px], metres per M, the pre-exposure
  view:vec4f, image:vec4f, origin:vec4f,
  right:vec4f, up:vec4f, forward:vec4f,
  sun:vec4f, irradiance:vec4f, sky:vec4f,
  // Each ellipsoid: centre/material; radii/hinge angle. Joints animate on the GPU.
  parts:array<vec4f,64>,
  scene:array<vec4f,6>,
  // The light probe round the camera (the ship's: trace.wgsl env, ship.wgsl envSH): the camera's axes in its axes.
  // probeX.w: on (fresh this frame); probeY.w: its GGX mips − 1; probeZ.w: unused.
  probeX:vec4f, probeY:vec4f, probeZ:vec4f,
  // The vessel's shadow map: its bounding sphere in the camera's axes [m] (w: radius; 0: none) — trace.wgsl shipShadow.
  shipBound:vec4f,
};
@group(0) @binding(0) var<uniform> u:U;
@group(0) @binding(1) var<storage,read> moments:array<vec2f>;
struct Command {vertices:u32, instances:atomic<u32>, first:u32, base:u32};
@group(0) @binding(4) var<storage,read_write> commands:array<Command>;
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

fn ggx(N:vec3f,V:vec3f,L:vec3f,rough:f32,f0:vec3f)->vec3f{
 let H=normalize(V+L);let nh=max(dot(N,H),0);let nv=max(dot(N,V),.001);let nl=max(dot(N,L),.001);let a=rough*rough;let aa=a*a;let d=nh*nh*(aa-1)+1;
 let D=aa/(3.141592*d*d);let G=.5/max(nl*sqrt(nv*nv*(1-aa)+aa)+nv*sqrt(nl*nl*(1-aa)+aa),.0001);
 return D*G*(f0+(vec3f(1)-f0)*pow(1-max(dot(V,H),0),5));
}
// The colour, and for the vessel drawn after: the distance [m] × coverage and the coverage (ship.wgsl: its occluder).
// (the occluder's alpha: the grass's blending reads it — the rg16float target keeps red and green)
struct Out { @location(0) color:vec4f, @location(1) occluder:vec4f };
@fragment fn fs(v:V,@builtin(front_facing) front:bool)->Out {
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
 let L=normalize(u.sun.xyz);let nl=max(dot(n,L),0);let vis=shadowAt(v.p,n)*nearSceneryShadow(v.p)*shipShadowAt(v.p);
 let Ek=keyIrradiance();
 let diffuse=color/PI;let direct=(diffuse*nl+ggx(n,eye,L,rough,f0)*nl)*Ek*vis;
 let F=f0+(vec3f(1)-f0)*pow(1-max(dot(n,eye),0),5);
 let ambient=diffuse*(vec3f(1)-F)*ambientIrradiance(n)+envSpecular(reflect(-eye,n),rough)*F;
 var o:Out;o.color=vec4f((direct+ambient)*u.image.w,1);o.occluder=vec4f(length(v.p),1,0,1);return o;
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
 var lit=1.0;if(s<.999||contact>=.003){lit=nearSceneryShadow(p)*shipShadowAt(p);}
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
fn forestData(i:u32)->vec4f{return nearScene[i];}
// BEGIN_FOREST_MODULE (shaders/forest.wgsl set in at load, src/forest-shader.ts: this stub casts no tree's shadow)
struct ForestHit { t: f32, n: vec3f, kind: u32, part: u32, base: vec3f, height: f32, seed: f32, ao: f32 };
fn forestQuery(o: vec3f, d: vec3f, tMax: f32, anyHit: bool, detail: f32) -> ForestHit { return ForestHit(tMax, vec3f(0.0), 0u, 0u, vec3f(0.0), 0.0, 0.0, 1.0); }
// END_FOREST_MODULE
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
  let base=u32(nearScene[0].y+hi.w);let p=nearScene[base];
  {
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
 // the trees (a world-fixed grid, not the hierarchy's)
 if(forestQuery(origin,d,500,true,40).kind>0u){return 0;}
 return 1;
}

// ======================================================================== the living ground
// Grass, crops, reeds, scrub, moss: every blade made on the GPU each frame from a lattice round the astronaut
// (a world-fixed grid of points, each jittered by its own hash: the same blade at the same place every frame),
// grown where the ground grid says something grows (WorldCover's class, the OSM roads, buildings, water and
// pavement left bare), in Voronoi clumps, crops in rows, thinned and widened with the distance, culled to the
// view and sorted into three levels of detail drawn indirectly. Wind gusts travel over it (the weather's wind),
// the astronaut pushes it aside and leaves footprints that rise again. Lit by the probe like the suit: its key
// light through the leaves, its sky, the trees', the vessel's and the astronaut's shadows, the canopy's own.
// After false-earth's grass (momentchan, MIT): its lattice, clumps, Bézier blades and view-facing tilt.
struct G {
  // the grass frame (fixed on the body for kilometres) in the camera's axes: origin [m] (w: reach [m]),
  // right (w: the lattice's spacing [m]), up (w: time [s]), forward (w: the density setting's share)
  origin:vec4f, gright:vec4f, gup:vec4f, gforward:vec4f,
  // the lattice's first point (i, j: whole), its points a side, the camera's pixel angle [rad]
  lattice:vec4f,
  // the ground grid's first cell (x, z: whole metres in the frame), its cells a side, ready (1)
  grid:vec4f,
  // the astronaut's feet in the frame [m] (x, y, z), his speed along the ground [m/s]
  walker:vec4f,
  // his heading in the frame (x, z), grounded (1), the frame's step [s]
  stride:vec4f,
  // the camera in the frame [m] (x, y, z), the wind's sway setting (1 as authored)
  eye:vec4f,
  // the wind blowing towards (x, z: unit, in the frame), its strength (0 calm, 1 a fresh breeze, 2 a gale), its gusts' speed [m/s]
  wind:vec4f,
  // the landed vessel's box in the frame: its centre (x, z), half sizes along its axis and across; its axis (x, z), on (1)
  hull:vec4f, hullAxis:vec4f,
  // the scenery's shade grid: its first cell (x, z: whole cells), cells a side, on (1)
  light:vec4f,
  // the footprints' ring: its cell [m], cells a side, the decay this frame, unused
  trample:vec4f,
  // the levels: until 0, until 1 [m], capacity 0, capacity 1; capacity 2, first instance 1, first instance 2, unused
  lods:vec4f, lods2:vec4f,
  // per kind of vegetation five vec4 (grass-layout.ts packVegetation)
  kinds:array<vec4f,40>,
};
@group(0) @binding(13) var<uniform> g:G;
@group(0) @binding(14) var<storage,read> grassCells:array<u32>;
@group(0) @binding(15) var<storage,read> grassHeights:array<f32>;
// a blade: its root in the camera's axes [m] and its height; width, bend, the tip's offset in the frame (x, z);
// packed (facing, seed, kind, flower, shade), its colour (√ of linear, rgba8), its squash, its sway phase
struct Blade { a:vec4f, b:vec4f, c:vec4u };
@group(0) @binding(16) var<storage,read_write> bladesOut:array<Blade>;
@group(0) @binding(17) var<storage,read> bladesIn:array<Blade>;
@group(0) @binding(18) var<storage,read_write> shade:array<f32>;
@group(0) @binding(19) var<storage,read_write> trample:array<vec4f>;
// the level drawn: its index, segments, first instance
@group(0) @binding(20) var<uniform> drawLod:vec4u;

fn pcg(v:u32)->u32{let s=v*747796405u+2891336453u;let w=((s>>((s>>28u)+4u))^s)*277803737u;return (w>>22u)^w;}
fn hash2(x:i32,z:i32,k:u32)->f32{return f32(pcg((bitcast<u32>(x)*1597334677u)^pcg((bitcast<u32>(z)*3812015801u)^k)))/4294967295.0;}
fn vnoise(p:vec2f)->f32{
 let i=vec2i(floor(p));let f=fract(p);let w=f*f*(3-2*f);
 let a=hash2(i.x,i.y,7u);let b=hash2(i.x+1,i.y,7u);let c=hash2(i.x,i.y+1,7u);let d=hash2(i.x+1,i.y+1,7u);
 return mix(mix(a,b,w.x),mix(c,d,w.x),w.y)*2-1;
}
fn fbm(p:vec2f)->f32{return vnoise(p)*.62+vnoise(p*2.07+vec2f(17.3,-9.1))*.27+vnoise(p*4.31+vec2f(-5.7,23.9))*.11;}
fn gridAt(x:f32,z:f32)->vec2i{return vec2i(i32(floor(x+.5))-i32(g.grid.x),i32(floor(z+.5))-i32(g.grid.y));}
fn cellAt(x:f32,z:f32)->u32{
 let c=gridAt(x,z);let n=i32(g.grid.z);
 if(any(c<vec2i(0))||any(c>=vec2i(n))){return 0u;}
 return grassCells[c.y*n+c.x];
}
fn groundHeight(x:f32,z:f32)->f32{
 let n=i32(g.grid.z);let q=vec2f(x-g.grid.x,z-g.grid.y);let i=clamp(vec2i(floor(q)),vec2i(0),vec2i(n-2));let f=clamp(q-vec2f(i),vec2f(0),vec2f(1));
 let k=i.y*n+i.x;
 return mix(mix(grassHeights[k],grassHeights[k+1],f.x),mix(grassHeights[k+n],grassHeights[k+n+1],f.x),f.y);
}
fn frameToCamera(x:f32,y:f32,z:f32)->vec3f{return g.origin.xyz+g.gright.xyz*x+g.gup.xyz*y+g.gforward.xyz*z;}
fn kind(k:u32,i:u32)->vec4f{return g.kinds[k*5u+i];}
fn srgbLinear(c:vec3f)->vec3f{return select(c/12.92,pow((c+.055)/1.055,vec3f(2.4)),c>vec3f(.04045));}
fn luma(c:vec3f)->f32{return dot(c,vec3f(.2126,.7152,.0722));}
// the trees' and the buildings' shade at (x, z) in the frame: the shade grid, bilinear (1: none)
fn sceneryShadeAt(x:f32,z:f32)->f32{
 if(g.light.w<.5){return 1;}
 let n=i32(g.light.z);let q=vec2f(x,z)/.5-g.light.xy;let i=clamp(vec2i(floor(q)),vec2i(0),vec2i(n-2));let f=clamp(q-vec2f(i),vec2f(0),vec2f(1));
 let k=i.y*n+i.x;
 return mix(mix(shade[k],shade[k+1],f.x),mix(shade[k+n],shade[k+n+1],f.x),f.y);
}
// a footprint's ring cell: where it is, whether it holds that place (its tag) — the ring wraps round the world
fn trampleIndex(gx:i32,gz:i32)->u32{let n=i32(g.trample.y);return u32(((gz%n)+n)%n*n+((gx%n)+n)%n);}
fn trampleTag(gx:i32,gz:i32)->f32{return f32((gx&4095)|((gz&4095)<<12))+.5;}

// The trees' and buildings' shade on the grass: once a frame on a 0.5 m grid (not once a blade).
@compute @workgroup_size(8,8) fn grassLight(@builtin(global_invocation_id) id:vec3u){
 let n=u32(g.light.z);if(id.x>=n||id.y>=n){return;}
 let x=(g.light.x+f32(id.x))*.5;let z=(g.light.y+f32(id.y))*.5;
 // (at mid-blade height)
 shade[id.y*n+id.x]=nearSceneryShadow(frameToCamera(x,groundHeight(x,z)+.25,z));
}
// The footprints: pressed where the feet stand, laid the way he walks, rising again over seconds.
@compute @workgroup_size(8,8) fn grassTrample(@builtin(global_invocation_id) id:vec3u){
 let n=i32(g.trample.y);if(i32(id.x)>=n||i32(id.y)>=n){return;}
 let cell=g.trample.x;
 // (the place this ring cell holds: the one nearest the astronaut)
 let w=vec2i(floor(g.walker.xz/cell));
 let gx=i32(id.x)+n*i32(round(f32(w.x-i32(id.x))/f32(n)));let gz=i32(id.y)+n*i32(round(f32(w.y-i32(id.y))/f32(n)));
 let k=trampleIndex(gx,gz);var t=trample[k];let tag=trampleTag(gx,gz);
 if(t.w!=tag){t=vec4f(0,0,0,tag);}
 t.z*=g.trample.z;
 let centre=(vec2f(f32(gx),f32(gz))+.5)*cell;let off=centre-g.walker.xz;let r=length(off);
 if(g.stride.z>.5&&r<.32){
  // (walking: laid forwards; standing: pressed outwards round the boots)
  let dir=select(off/max(r,1e-4),g.stride.xy,g.walker.w>.25);
  let press=1-smoothstep(.18,.32,r);
  if(press>t.z){t=vec4f(normalize(mix(t.xy+vec2f(1e-4),dir,.6)),press,tag);}
 }
 trample[k]=t;
}
// Every lattice point round the astronaut: a blade or none, culled, its level chosen, its instance written.
@compute @workgroup_size(16,16) fn grassBlades(@builtin(global_invocation_id) id:vec3u){
 let n=u32(g.lattice.z);if(id.x>=n||id.y>=n||g.grid.w<.5){return;}
 let gi=i32(g.lattice.x)+i32(id.x);let gj=i32(g.lattice.y)+i32(id.y);let s=g.gright.w;
 var x=(f32(gi)+hash2(gi,gj,1u))*s;var z=(f32(gj)+hash2(gi,gj,2u))*s;
 let reach=g.origin.w;
 let fromWalker=length(vec2f(x,z)-g.walker.xz);if(fromWalker>reach){return;}
 // (the cheap tests first: most points leave here — out of the view, or thinned out by the distance)
 let ec=g.eye.xyz-vec3f(x,0,z);let dCam=length(vec2f(ec.x,ec.z));
 let keepD=select(max(.18,pow(5/max(dCam,5.0),1.1)),1.0,dCam<=5);
 let thin=hash2(gi,gj,5u);if(thin>=keepD*g.gforward.w*1.1){return;}
 let early=frameToCamera(x,groundHeight(x,z),z);
 if(early.z<-2.2||abs(early.x)>early.z*u.view.x+2.4||abs(early.y-1.1)>early.z*u.view.y+2.4){return;}
 // (what grows: the class's edges frayed by a smooth warp of metres, the bare strips' — paths, roads — by a fine jitter)
 let warp=vec2f(vnoise(vec2f(x,z)*.13),vnoise(vec2f(z,x)*.13+31.7))*2.6;
 let code=cellAt(x+warp.x,z+warp.y);var k=code>>24u;
 if(cellAt(x+(hash2(gi,gj,3u)-.5)*.9,z+(hash2(gi,gj,4u)-.5)*.9)>>24u==0u){k=0u;}
 if(k==0u||k>7u){return;}
 let K0=kind(k,0u);let K1=kind(k,1u);let K2=kind(k,2u);
 // (the vessel's box: nothing grows crushed under it)
 if(g.hullAxis.w>.5){let q=vec2f(x,z)-g.hull.xy;let a=g.hullAxis.xy;if(abs(dot(q,a))<g.hull.z&&abs(q.x*a.y-q.y*a.x)<g.hull.w){return;}}
 // clumps: the nearest Voronoi point and the second (their parameters blended at the boundaries)
 let cs=K2.x;let cp=vec2f(x,z)/cs;let ci=vec2i(floor(cp));let cf=fract(cp);
 var best=1e9;var second=1e9;var bestId=vec2i(0);var toCentre=vec2f(0);
 for(var oy=-1;oy<=1;oy++){for(var ox=-1;ox<=1;ox++){
  let c=ci+vec2i(ox,oy);let pt=vec2f(f32(ox),f32(oy))+vec2f(hash2(c.x,c.y,11u),hash2(c.x,c.y,12u));let d=pt-cf;let d2=dot(d,d);
  if(d2<best){second=best;best=d2;bestId=c;toCentre=d*cs;}else if(d2<second){second=d2;}
 }}
 let edge=smoothstep(0.0,.35,sqrt(second)-sqrt(best));
 let ch=hash2(bestId.x,bestId.y,13u);let ch2=hash2(bestId.x,bestId.y,14u);
 // density: the kind's, the setting's, the distance's thinning; sparse kinds gather in tufts (gaps between)
 var want=K0.x*g.gforward.w*keepD;
 if(K0.x<.6){want*=mix(.15,1.9,smoothstep(.55,.1,length(toCentre)/cs))*(.5+ch);}
 if(thin>=want){return;}
 // crops: the blades drawn onto their rows (a direction per field, a 60 m cell of it)
 if(K2.y>0){
  let field=vec2i(floor(vec2f(x,z)/60));let ra=hash2(field.x,field.y,21u)*3.14159;let nrm=vec2f(cos(ra),sin(ra));
  let along=dot(vec2f(x,z),nrm)/K2.y;let off=(round(along)-along)*K2.y;
  x+=nrm.x*off*.82;z+=nrm.y*off*.82;
 }
 let h0=groundHeight(x,z);
 let root=frameToCamera(x,h0,z);
 // (the view: the blade's sphere in the frustum)
 let hMax=K0.z*1.3+.1;
 if(root.z<-hMax||abs(root.x)>root.z*u.view.x+hMax+.2||abs(root.y-hMax*.5)>root.z*u.view.y+hMax+.2){return;}
 // its figures: the clump's, varied per blade
 let bh=hash2(gi,gj,6u);let bw=hash2(gi,gj,7u);let bb=hash2(gi,gj,8u);
 let rows=select(1.0,.12,K2.y>0);
 // (sinking into the ground over the reach's last 4 m: no edge to the field — before the wind and the legs lean it)
 var height=mix(K0.y,K0.z,mix(.5,ch,edge))*mix(1-.28*rows,1+.22*rows,bh)*(1-smoothstep(reach-4,reach,fromWalker));
 var width=mix(K1.x,K1.y,bw);
 var bend=mix(K1.z,K1.w,mix(.5,ch2,edge))*(.7+.6*bb);
 // facing: the clump's, the blade's own, a little towards the clump's middle
 var facing=ch2*6.28318+(hash2(gi,gj,9u)-.5)*3.2+atan2(toCentre.y,toCentre.x)*.15*edge;
 // the wind: gusts travelling downwind over the field, the blades turned a little to it
 let wd=g.wind.xy;let t=g.gup.w;
 let gust=fbm(vec2f(x,z)*.075-wd*t*g.wind.w*.075);
 let windNow=g.wind.z*(.7+.3*gust)*g.eye.w;
 let wa=atan2(wd.y,wd.x);facing+=atan2(sin(wa-facing),cos(wa-facing))*.35*clamp(windNow,0.0,1.0);
 var tip=wd*windNow*height*.32*(1-.6*rows);
 // the astronaut: pushed aside round his legs; his footprints, laid down
 let fromFeet=vec2f(x,z)-g.walker.xz;let r=length(fromFeet);
 var squash=0.0;
 if(r<.75&&abs(h0-g.walker.y)<1.2){let push=1-smoothstep(.2,.7,r);tip+=fromFeet/max(r,1e-3)*push*height*.55;squash=push*.25;}
 let tc=vec2i(floor(vec2f(x,z)/g.trample.x));let tr=trample[trampleIndex(tc.x,tc.y)];
 // (a footprint fades before its ring cell is given to another place, 8 m away: no blade springing up at once)
 let ring=max(abs(fromFeet.x),abs(fromFeet.y));let press=tr.z*(1-smoothstep(5.5,7.5,ring));
 if(tr.w==trampleTag(tc.x,tc.y)&&press>.01){tip+=tr.xy*press*height*.8;squash=max(squash,press*.75);}
 // the far blades: fewer, wider (the field's cover kept), sinking into the ground at the reach (no edge)
 width*=select(1.0,min(2.4,inverseSqrt(keepD)),dCam>5);
 // shade: the trees', the buildings', the vessel's (at two thirds of its height)
 let sh=sceneryShadeAt(x,z)*shipShadowAt(root+g.gup.xyz*height*.66);
 // its colour: the kind's tip, its hue from the satellite where there is one, varied per clump and blade
 var col=kind(k,4u).rgb;
 let rgb=code&0xffffffu;
 if(rgb!=0u){
  let sat=srgbLinear(vec3f(f32(rgb&255u),f32((rgb>>8u)&255u),f32((rgb>>16u)&255u))/255);
  let hue=sat/max(luma(sat),1e-4);col=mix(col,clamp(hue,vec3f(0),vec3f(2.5))*luma(col),K2.z);
 }
 col*=(.82+.3*ch)*(.9+.2*bw);
 // a share of straw among the green — more where the ground is dry (scrub, bare) — and, in a meadow, seed heads above it
 let dryShare=select(select(.1,.3,k==3u),.5,k==6u)*select(1.0,.2,k==2u||k==7u);
 if(hash2(gi,gj,18u)<dryShare){col=mix(col,vec3f(.4,.33,.16)*(.7+.5*bw),.75);}
 var seed=0u;
 if(k==1u&&hash2(gi,gj,19u)<.07){seed=1u;height*=1.35;width*=.75;}
 // the thatch: in the dense kinds a third of the blades short and lying — the ground under a meadow is hidden,
 // seen from above as from the side (upright blades are seen edge-on from above)
 var lying=0.0;
 if(K0.x>.6&&k!=7u&&seed==0u&&hash2(gi,gj,20u)<.36){lying=1.0;height*=.5;width*=1.7;col*=.8;}
 bend=mix(bend,.85,lying);
 let flower=select(0u,1u,lying<.5&&k==1u&&hash2(gi,gj,10u)<K0.w*(.4+1.6*step(.62,ch)));
 // its level: by the camera's distance, the boundaries dithered
 let dl=dCam*(1+(hash2(gi,gj,15u)-.5)*.12);
 let lod=select(select(0u,1u,dl>=g.lods.x),2u,dl>=g.lods.y);
 let cap=u32(select(select(g.lods.z,g.lods.w,lod==1u),g.lods2.x,lod==2u));
 let first=select(select(0u,u32(g.lods2.y),lod==1u),u32(g.lods2.z),lod==2u);
 let at=atomicAdd(&commands[lod].instances,1u);if(at>=cap){return;}
 let facing8=u32(fract(facing/6.28318+1)*255.0);
 let packed=facing8|(u32(bb*255.0)<<8u)|(k<<16u)|(flower<<20u)|(u32(hash2(gi,gj,16u)*7.99)<<21u)|(u32(clamp(sh,0.0,1.0)*255.0)<<24u);
 bladesOut[first+at]=Blade(vec4f(root,height),vec4f(width,bend,tip),vec4u(packed,pack4x8unorm(vec4f(sqrt(clamp(col,vec3f(0),vec3f(1))),1)),u32(clamp(squash,0.0,1.0)*255.0)|(seed<<8u),bitcast<u32>(hash2(gi,gj,17u)*6.28318)));
}
// (more blades than a level holds: the draw keeps its capacity)
@compute @workgroup_size(1) fn grassClamp(){
 atomicMin(&commands[0].instances,u32(g.lods.z));atomicMin(&commands[1].instances,u32(g.lods.w));atomicMin(&commands[2].instances,u32(g.lods2.x));
}
struct GV { @builtin(position) clip:vec4f, @location(0) p:vec3f, @location(1) n:vec3f, @location(2) side:vec3f,
 @location(3) blade:vec2f, @location(4) @interpolate(flat) albedo:vec3f, @location(5) @interpolate(flat) info:vec4f, @location(6) coverage:f32 };
fn bezier(p0:vec3f,p1:vec3f,p2:vec3f,p3:vec3f,t:f32)->vec3f{let s=1-t;return p0*s*s*s+p1*3*s*s*t+p2*3*s*t*t+p3*t*t*t;}
fn bezierTangent(p0:vec3f,p1:vec3f,p2:vec3f,p3:vec3f,t:f32)->vec3f{let s=1-t;return (p1-p0)*3*s*s+(p2-p1)*6*s*t+(p3-p2)*3*t*t;}
@vertex fn grassVs(@builtin(vertex_index) v:u32,@builtin(instance_index) instance:u32)->GV{
 let bl=bladesIn[drawLod.z+instance];let segments=f32(drawLod.y);
 let corners=array<vec2f,6>(vec2f(0,-1),vec2f(1,-1),vec2f(0,1),vec2f(0,1),vec2f(1,-1),vec2f(1,1));
 let c=corners[v%6u];let t=(f32(v/6u)+c.x)/segments;
 let h=bl.a.w;var width=bl.b.x;let bend=bl.b.y;let tip=bl.b.zw;let packed=bl.c.x;let squash=f32(bl.c.z&255u)/255;let seed=(bl.c.z>>8u)&1u;let phase=bitcast<f32>(bl.c.w);
 let k=(packed>>16u)&15u;let flower=(packed>>20u)&1u;let head=select(kind(k,2u).w,3.0,seed==1u);
 let facing=f32(packed&255u)/255*6.28318;let sd=vec2f(cos(facing),sin(facing));let fd=vec2f(-sd.y,sd.x);
 // the spine (frame: x right, y up, z forward): leaning by its bend, its tip pushed (wind, legs, footprints), its length kept
 let lean=fd*bend*h+tip;let topY=sqrt(max(h*h-dot(lean,lean),h*h*.02))*(1-squash);
 let p1=vec3f(fd.x*bend*h*.3+tip.x*.12,topY*.42,fd.y*bend*h*.3+tip.y*.12);
 let p2=vec3f(fd.x*bend*h*.72+tip.x*.5,topY*.8,fd.y*bend*h*.72+tip.y*.5);
 let p3=vec3f(lean.x,topY,lean.y);
 var spine=bezier(vec3f(0),p1,p2,p3,t);let tangent=bezierTangent(vec3f(0),p1,p2,p3,max(t,.02));
 // flutter: the tip's quick shiver across the blade, stronger as the wind leans it
 let amp=(length(tip)*.18+.004*h)*g.eye.w;
 let fl=sin(g.gup.w*(2.3+1.7*fract(phase*3.7))+phase+t*2.7)+.35*sin(g.gup.w*7.9+phase*1.7+t*5.0);
 spine+=vec3f(sd.x,0,sd.y)*fl*amp*t*t;
 let rootC=bl.a.xyz;
 let toC=g.gright.xyz*spine.x+g.gup.xyz*spine.y+g.gforward.xyz*spine.z;
 let p=rootC+toC;
 let tanC=normalize(g.gright.xyz*tangent.x+g.gup.xyz*tangent.y+g.gforward.xyz*tangent.z);
 // its side turned towards the camera a little (seen edge-on, a blade is not a line: false-earth's tilt)
 var side=normalize(g.gright.xyz*sd.x+g.gforward.xyz*sd.y);let view=normalize(-p);
 side=normalize(side-view*dot(side,view)*.55);
 // its width along it: narrow at the root, widest low, to a point; heads: an ear, a plume, a flower
 var w=width*1.9*(t+.3)*pow(max(1-t,0.0),.9);
 if(head>.5&&head<1.5&&t>.66){w=width*1.45*pow(sin(clamp((t-.66)/.33,0.0,1.0)*3.14159),.6);}
 if(head>1.5&&t>.8){w=width*2.0*sin(clamp((t-.8)/.2,0.0,1.0)*3.14159);}
 if(head>2.5&&t>.7){w=width*1.7*sin(clamp((t-.7)/.3,0.0,1.0)*3.14159);}
 if(flower==1u&&t>.84){w=width*4.2*sin(clamp((t-.84)/.16,0.0,1.0)*3.14159);}
 // (never thinner than most of a pixel: its coverage carries the rest)
 let pixel=max(p.z,.05)*g.lattice.w;let rw=max(w,pixel*.75*(1-t*.5));
 var o:GV;o.p=p+side*c.y*rw;o.clip=project(o.p);
 o.n=normalize(cross(side,tanC));o.side=side;o.blade=vec2f(c.y,t);
 let col=unpack4x8unorm(bl.c.y).rgb;o.albedo=col*col;
 o.info=vec4f(f32(k),f32(flower)+f32((packed>>21u)&7u)*2.0,f32(packed>>24u)/255,head);
 o.coverage=min(1.0,w/max(rw,1e-6));
 return o;
}
@fragment fn grassFs(v:GV,@builtin(front_facing) front:bool)->Out{
 let pixel=vec2u(v.clip.xy);let at=min(pixel.y,u32(u.image.y)-1u)*u32(u.image.x)+min(pixel.x,u32(u.image.x)-1u);
 if(moments[at].y*u.image.z<length(v.p)-.03){discard;}
 let edgeWidth=max(fwidth(v.blade.x),.001);let coverage=(1-smoothstep(1-edgeWidth,1+edgeWidth,abs(v.blade.x)))*v.coverage;
 if(coverage<.004){discard;}
 let t=saturate(v.blade.y);let k=u32(v.info.x+.5);let head=v.info.w;
 let eye=normalize(-v.p);
 // a rounded blade: its midrib and rims bend the normal across it
 var n=normalize(v.n+v.side*v.blade.x*.55);if(dot(n,eye)<0){n=-n;}
 // its colour: root dark to tip, the kind's ratio; an ear golden, a plume tawny, a flower's petals
 let tipCol=v.albedo;let baseRatio=luma(kind(k,3u).rgb)/max(luma(kind(k,4u).rgb),1e-4);
 var albedo=mix(tipCol*baseRatio,tipCol,pow(t,.75));
 if(head>.5&&head<1.5&&t>.66){albedo=mix(albedo,tipCol*vec3f(1.2,1.02,.62),.75)*(.85+.3*step(.5,fract(t*38)));}
 if(head>1.5&&head<2.5&&t>.8){albedo=vec3f(.16,.1,.05);}
 if(head>2.5&&t>.7){albedo=mix(albedo,vec3f(.3,.24,.15),.65);}
 let flower=u32(v.info.y+.5);
 if((flower&1u)==1u&&t>.84){
  let petals=array<vec3f,4>(vec3f(.75,.74,.7),vec3f(.7,.52,.05),vec3f(.32,.16,.55),vec3f(.62,.06,.05));
  albedo=petals[(flower>>1u)&3u];
 }
 let L=normalize(u.sun.xyz);let Ek=keyIrradiance();let up=normalize(g.gup.xyz);
 // shadows: the astronaut's, the scenery's and the vessel's (the blade's), the canopy's own — a low Sun lights the tips, the roots stay in the field's shade
 let sunUp=max(dot(L,up),0);
 let canopy=mix(1.0,smoothstep(-.05,.85,t+sunUp*.7),clamp(kind(k,0u).x*1.2,0.0,1.0));
 let vis=shadowAt(v.p,n)*v.info.z*canopy;
 let nl=max(dot(n,L),0);
 let diffuse=albedo/PI*nl;
 // the light through the leaf: diffusely through a blade lit on its other face (a leaf passes about half of the
 // green it receives), and a forward lobe towards an eye looking into the light
 // (a leaf passes ~half: diffusely through its far face, and a normalised forward lobe ((k+1)/2π, k=1.6) —
 // together never more than the light it receives)
 let back=max(dot(-n,L),0);
 let through=albedo*(.3*back/PI+.25*.414*pow(max(dot(eye,-L),0),1.6)*(1-nl*.5))*(.3+.7*t);
 let spec=ggx(n,eye,L,.42,vec3f(.035))*nl;
 let direct=(diffuse+through+spec)*Ek*vis;
 // the sky and the ground's light, darker into the field (its depth: the roots)
 let ao=mix(.22,1.0,pow(t,.7));
 let ambient=albedo/PI*ambientIrradiance(n)*ao+envSpecular(reflect(-eye,n),.5)*.03*ao;
 var o:Out;o.color=vec4f((direct+ambient)*u.image.w*coverage,coverage);o.occluder=vec4f(length(v.p)*coverage,coverage,0,coverage);return o;
}
