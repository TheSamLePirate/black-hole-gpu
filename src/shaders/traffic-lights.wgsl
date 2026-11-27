struct Params { proj:vec4f, scale:vec4f, depthSize:vec4f }
struct Lamp { at:vec4f, colour:vec4f }
@group(0) @binding(0) var<uniform> P:Params;
@group(0) @binding(1) var<storage,read> lamps:array<Lamp>;
@group(0) @binding(2) var<storage,read> depth:array<f32>;
struct Out { @builtin(position) clip:vec4f, @location(0) uv:vec2f, @location(1) @interpolate(flat) index:u32 }
fn hidden(pixel:vec2f,distance:f32)->bool {
  if(any(pixel<vec2f(0.0))||any(pixel>=P.proj.zw)) {return true;}
  let q=vec2u(pixel/P.proj.zw*P.depthSize.xy);
  let z=depth[q.y*u32(P.depthSize.x)+q.x]*P.scale.x;
  return z>0.0 && z<distance-0.08;
}
@vertex fn vs(@builtin(vertex_index) vi:u32,@builtin(instance_index) ii:u32)->Out {
  let corner=array<vec2f,6>(vec2f(-1,-1),vec2f(1,-1),vec2f(-1,1),vec2f(-1,1),vec2f(1,-1),vec2f(1,1))[vi];
  let l=lamps[ii];let c=l.at.xyz;
  let ndc=vec2f(c.x/(max(c.z,0.01)*P.proj.x),c.y/(max(c.z,0.01)*P.proj.y));
  let px=vec2f((ndc.x+1.0)*0.5,(1.0-ndc.y)*0.5)*P.proj.zw;
  var o:Out;o.index=ii;o.uv=corner;
  let radius=clamp(l.at.w*0.35/max(c.z,0.01)/P.proj.y*P.proj.w*0.5,2.0,8.0)*2.5;
  o.clip=vec4f(ndc+corner*radius*2.0/P.proj.zw,0,1);
  // Test the lamp centre BEFORE expanding the halo. A hidden source produces no edge leakage.
  if(c.z<=1.0||hidden(px,length(c))) {o.clip=vec4f(2,2,0,1);}
  return o;
}
@fragment fn fs(o:Out)->@location(0) vec4f {
  let l=lamps[o.index];let r=length(o.uv);
  if(r>=1.0||hidden(o.clip.xy,length(l.at.xyz))) {discard;}
  let glow=exp(-r*r*20.0)+0.15*exp(-r*r*5.0);
  return vec4f(l.colour.rgb*glow*P.scale.y,0);
}
