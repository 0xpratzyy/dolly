// Animated shader wallpapers. One full-screen quad, WebGL1 / GLSL ES 1.0, drawn from a time uniform (seconds = frame / fps), so
// every frame is a pure function of (width, height, time): the Remotion CLI render and the browser <Player> draw the same pixels.
// No Date.now, no Math.random. Every shader ends in a fine interleaved-gradient dither, so there is no banding even on dark ramps.
// All scenes are original. Motion is slow on purpose.

export interface ShaderDef {
  id: string;
  name: string;
  /** Which fragment program (key of PROGRAMS). Several presets can share one program with different colours. */
  program: string;
  /** Up to five sRGB hex colours, passed as uC0..uC4 (the program says what each one means). */
  colors: string[];
  /** Dark wallpaper (drives window chrome and keystroke colours). */
  dark: boolean;
  /** Static CSS approximation, for places that can only use CSS (backgroundStyle) and for a failed WebGL context. */
  fallback: string;
  /** Render scale, 0.4..1. Backgrounds are soft, so less than 1 is fine and faster. */
  res: number;
  /** Time offset in seconds, so the frame 0 is a good-looking moment and presets sharing a program differ. */
  t0?: number;
}

const HEADER = `
precision highp float;
uniform vec2 uRes; uniform float uTime;
uniform vec3 uC0; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
#define TAU 6.28318530718
float hash11(float p){ p=fract(p*.1031); p*=p+33.33; p*=p+p; return fract(p); }
float hash21(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
vec2 hash22(vec2 p){ vec3 q=fract(vec3(p.xyx)*vec3(.1031,.1030,.0973)); q+=dot(q,q.yzx+33.33); return fract((q.xx+q.yz)*q.zy); }
float vnoise(vec2 p){
  vec2 i=floor(p); vec2 f=fract(p); f=f*f*f*(f*(f*6.-15.)+10.);
  float a=hash21(i), b=hash21(i+vec2(1.,0.)), c=hash21(i+vec2(0.,1.)), d=hash21(i+vec2(1.,1.));
  return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);
}
float fbm(vec2 p){
  float s=0.; float a=.5;
  mat2 m=mat2(.8,.6,-.6,.8);
  for(int i=0;i<5;i++){ s+=a*vnoise(p); p=m*p*2.03+vec2(17.1,9.7); a*=.5; }
  return s/.96875;
}
float fbm3(vec2 p){
  float s=0.; float a=.5;
  mat2 m=mat2(.8,.6,-.6,.8);
  for(int i=0;i<3;i++){ s+=a*vnoise(p); p=m*p*2.03+vec2(17.1,9.7); a*=.5; }
  return s/.875;
}
float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(.06711056,.00583715)))); }
// aspect-correct coordinates: height spans -.5..+.5 in landscape, width spans -.5..+.5 in portrait
vec2 aspectP(vec2 uv){ float a=uRes.x/uRes.y; return (uv-.5)*vec2(a,1.)*max(1.,1./a); }
vec3 finish(vec3 c, float vig){
  c=clamp(c,0.,1.);
  c*=vig;
  // two-sample dither, +-1 LSB
  float n=ign(gl_FragCoord.xy)+ign(gl_FragCoord.xy+vec2(37.,17.))-1.;
  return c+n/255.;
}
`;

export const PROGRAMS: Record<string, string> = {
  // ---------------------------------------------------------------- liquid: domain-warped fbm gradients
  // C0 deep base, C1 body, C2 mid glow, C3 bright accent, C4 highlight
  liquid: `
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv)*1.15;
  float t=uTime*.04;
  vec2 q=vec2(fbm3(p+vec2(0.,t)), fbm3(p+vec2(5.2,1.3)-t));
  vec2 r=vec2(fbm3(p+1.9*q+vec2(1.7,9.2)+t*1.3), fbm3(p+1.9*q+vec2(8.3,2.8)-t*1.1));
  float f=fbm(p*.85+2.0*r);
  vec3 col=mix(uC0,uC1,smoothstep(.1,.6,f));
  col=mix(col,uC2,smoothstep(.28,.9,length(q)*(.5+.9*r.x)));
  col=mix(col,uC3,smoothstep(.4,.9,r.y*f*2.3)*.85);
  // soft sheen following the flow, gives the liquid depth
  float e=.02;
  float fx=fbm(p*.85+2.0*r+vec2(e,0.))-f; float fy=fbm(p*.85+2.0*r+vec2(0.,e))-f;
  vec3 n=normalize(vec3(-fx/e*.12,-fy/e*.12,1.));
  float spec=pow(max(dot(n,normalize(vec3(-.4,.6,.7))),0.),22.);
  col+=uC4*spec*.14;
  col+=uC4*smoothstep(.55,.95,f)*.10;
  float vig=1.-.28*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- aurora: night sky, curtains, stars
  // C0 zenith, C1 horizon glow, C2 green curtain, C3 violet/teal curtain top, C4 star tint
  aurora: `
float curtain(vec2 uv, vec2 p, float k, float t){
  float x=p.x;
  float yb=.30+.07*k+.09*sin(x*2.4+t*.30+k*1.7)+.07*(fbm3(vec2(x*1.1+k*4.,t*.12))-.5)*2.;
  float d=uv.y-yb;
  float below=smoothstep(-.015,.01,d);
  float fade=exp(-max(d,0.)*(3.6-.5*k));
  float rays=.38+.62*vnoise(vec2(x*20.+sin(t*.2+k)*1.5+k*7., uv.y*1.4-t*.06));
  rays*=.65+.35*vnoise(vec2(x*5.5-k*3.,t*.15));
  return below*fade*rays*(.85-.15*k);
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float t=uTime;
  vec3 col=mix(uC1,uC0,pow(clamp(uv.y*1.15,0.,1.),.7));
  col=mix(uC1*.55,col,smoothstep(0.,.35,uv.y));
  float glow=0.;
  vec3 au=vec3(0.);
  for(int k=0;k<3;k++){
    float fk=float(k);
    float c=curtain(uv,p*(1.+.18*fk)+vec2(fk*.37,0.),fk,t);
    float h=clamp((uv.y-.28)*2.2,0.,1.);
    vec3 ac=mix(uC2,uC3,smoothstep(.0,.9,h+.15*fk));
    au+=ac*c*(1.1-.25*fk);
    glow+=c;
  }
  col+=au*.95;
  // stars, dimmed where the aurora is bright
  vec2 g=p*vec2(1.,1.)*110.;
  vec2 id=floor(g); vec2 f=fract(g)-.5;
  float h=hash21(id);
  float star=step(.972,h);
  vec2 off=(hash22(id+7.)-.5)*.6;
  float d=length(f-off);
  float tw=.75+.25*sin(t*.7+h*60.);
  float s=star*smoothstep(.2,.0,d)*tw*(.25+.75*hash21(id+3.));
  float big=step(.9965,h)*smoothstep(.35,.0,d)*tw;
  col+=uC4*(s*.8+big*.9)*clamp(1.-glow*1.2,0.,1.)*smoothstep(.12,.5,uv.y);
  float vig=1.-.35*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- silk: satin folds with a soft specular
  // C0 shadow, C1 body, C2 sheen, C3 specular tint
  silk: `
float fold(vec2 p, float t){
  vec2 w=p;
  w+=.30*vec2(sin(p.y*1.2+t*.25),cos(p.x*.9-t*.2));
  float f=sin(w.x*2.7+w.y*1.6+.9*sin(w.y*1.9+t*.18));
  f+=.5*sin(w.x*5.3-w.y*.8+1.7+.6*sin(w.x*1.3+t*.2));
  f+=.16*sin(w.x*11.+w.y*3.+t*.12+sin(w.y*4.));
  return f*.42;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv)*1.1;
  float t=uTime;
  float e=.004;
  float h=fold(p,t);
  float hx=fold(p+vec2(e,0.),t)-h; float hy=fold(p+vec2(0.,e),t)-h;
  vec3 n=normalize(vec3(-hx/e*.9,-hy/e*.9,1.));
  vec3 L=normalize(vec3(-.45,.55,.7));
  float diff=clamp(dot(n,L)*.9+.12,0.,1.);
  vec3 V=vec3(0.,0.,1.);
  vec3 H=normalize(L+V);
  float spec=pow(max(dot(n,H),0.),60.);
  // anisotropic-ish satin: sheen follows the fold direction
  float sheen=pow(max(1.-abs(dot(n,V)),0.),2.2);
  vec3 col=mix(uC0,uC1,smoothstep(.1,.7,diff));
  col=mix(col,uC2,smoothstep(.5,.95,diff)*.7);
  col+=uC3*spec*.45+uC2*sheen*.12;
  col*=.8+.3*h;
  float vig=1.-.35*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- lightleak: warm film leaks from the edges over dark
  // C0 dark base, C1 amber, C2 red/pink, C3 yellow-white core, C4 magenta
  lightleak: `
float blob(vec2 p, vec2 c, vec2 s){ vec2 d=(p-c)/s; return exp(-dot(d,d)); }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float a=uRes.x/uRes.y; float t=uTime*.07;
  float hx=.5*max(a,1.);
  vec3 col=uC0;
  float l1=blob(p,vec2(-hx-.02+.10*sin(t*1.3),.12+.16*sin(t*.9+1.)),vec2(.42,.62+.08*sin(t*1.7)));
  float l2=blob(p,vec2(-hx+.16+.12*sin(t*1.1+2.),-.46+.06*sin(t)),vec2(.55,.20));
  float l3=blob(p,vec2(hx+.05+.08*sin(t*.8),.5+.1*sin(t*1.2)),vec2(.35,.46));
  float l4=blob(p,vec2(hx*.15+.2*sin(t*.7),.58),vec2(.8,.12));
  vec3 leak=vec3(0.);
  leak+=uC1*l1*1.15;
  leak+=uC3*pow(l1,3.)*.55;
  leak+=uC2*l2*.95;
  leak+=uC4*l3*.75;
  leak+=uC1*l4*.35;
  // faint diagonal streak, like light bleeding past the gate
  float s=dot(p,normalize(vec2(1.,.38)));
  float streak=exp(-pow((s+.1*sin(t*1.5)-.15)*5.,2.))*.12;
  leak+=uC1*streak*smoothstep(-.7,.4,-p.x);
  // grain-free flicker, very small
  leak*=.94+.06*sin(uTime*.9);
  col=1.-(1.-col)*(1.-clamp(leak,0.,1.));
  float vig=1.-.2*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- caustics: pool light
  // C0 deep water, C1 mid water, C2 light water, C3 caustic highlight
  caustics: `
float ridge(vec2 p){ return 1.-abs(2.*vnoise(p)-1.); }
float net(vec2 p, float t){
  vec2 q=p+.55*vec2(fbm3(p*.7+vec2(t*.5,0.)),fbm3(p*.7+vec2(3.,t*.4)));
  float a=ridge(q*2.1+vec2(t*.35,-t*.2));
  float b=ridge(q*2.1*1.37+vec2(-t*.28,t*.31)+7.);
  return pow(a*b,2.2)*2.2;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv)*2.1;
  float t=uTime*.45;
  float depth=fbm3(p*.35+vec2(t*.1,-t*.05));
  vec3 col=mix(uC0,uC1,smoothstep(.2,.8,depth));
  col=mix(col,uC2,smoothstep(.45,1.1,uv.y*.55+depth*.5));
  float c=net(p,t)+.55*net(p*1.8+4.,t*1.3);
  c=clamp(c,0.,1.6);
  col+=uC3*c*.27;
  col=mix(col,vec3(1.),smoothstep(1.0,1.6,c)*.18);
  float vig=1.-.15*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- bokeh: soft drifting out-of-focus discs
  // C0 gradient top, C1 gradient bottom, C2..C4 disc colours
  bokeh: `
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float a=max(uRes.x/uRes.y,1.);
  float t=uTime*.05;
  vec3 col=mix(uC1,uC0,smoothstep(0.,1.,uv.y));
  col+=uC2*.22*exp(-pow(length(p-vec2(.25*a,-.25))*1.3,2.))+uC4*.10*exp(-pow(length(p-vec2(-.3*a,.3))*1.5,2.));
  vec3 acc=vec3(0.);
  for(int i=0;i<30;i++){
    float fi=float(i);
    float h1=hash11(fi*1.7+.3), h2=hash11(fi*3.1+1.1), h3=hash11(fi*5.3+2.7), h4=hash11(fi*7.9+4.2);
    vec2 c=vec2((h1-.5)*(a+.3), (h2-.5)*1.15);
    c+=vec2(.09*sin(t*(1.+h3)*3.+fi),.07*cos(t*(.8+h4)*3.+fi*1.3));
    float r=.035+.11*h3*h3+.03*h4;
    float d=length(p-c);
    float edge=smoothstep(r,r*.82,d);
    float rim=smoothstep(r*.72,r,d)*smoothstep(r*1.04,r*.9,d);
    float disc=edge*(.55+1.1*rim);
    vec3 dc=h4<.34?uC2:(h4<.67?uC3:uC4);
    float amp=(.16+.34*(1.-h3))*(.8+.2*sin(t*3.+fi*2.));
    acc+=dc*disc*amp;
  }
  col+=acc;
  float vig=1.-.3*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- dusk-sky: grainy sky, clouds, low sun glow
  // C0 zenith, C1 mid sky, C2 horizon, C3 sun glow, C4 cloud shadow
  dusk: `
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float t=uTime*.012;
  float y=uv.y;
  vec3 col=mix(uC2,uC1,smoothstep(.02,.5,y));
  col=mix(col,uC0,smoothstep(.35,1.,y));
  vec2 sun=vec2(.34,.12);
  float sd=length((uv-sun)*vec2(uRes.x/uRes.y,1.));
  col+=uC3*exp(-sd*sd*3.6)*.55+uC3*exp(-sd*sd*26.)*.28;
  // clouds: stretched, lit from below by the sun
  vec2 cp=vec2(p.x*1.1+t*3.,y*3.4);
  float c=fbm(cp+vec2(fbm3(cp*.6+t),0.)*1.4);
  float dens=smoothstep(.46,.78,c)*smoothstep(.05,.3,y)*(1.-smoothstep(.75,1.,y)*.7);
  float c2=fbm(cp+vec2(0.,-.12));
  float lit=clamp((c-c2)*5.+.5,0.,1.);
  vec3 cc=mix(uC4,mix(uC2,uC3,.7),lit*smoothstep(.0,.9,exp(-sd*1.3)+.2));
  col=mix(col,cc,dens*.9);
  // thin high cirrus streaks
  float ci=fbm3(vec2(p.x*.7+t*5.,y*18.));
  col=mix(col,uC3*1.05,smoothstep(.62,.9,ci)*smoothstep(.35,.7,y)*.12);
  float vig=1.-.22*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- hills: painterly rolling-hill meadow
  // C0 sky top, C1 sky horizon, C2 far hills (hazy), C3 near hills (deep), C4 sun-lit grass
  hills: `
float n1(float x){ float i=floor(x); float f=fract(x); f=f*f*f*(f*(f*6.-15.)+10.); return mix(hash11(i),hash11(i+1.),f); }
float hillH(float x, float s){ return n1(x+s)*.62+n1(x*2.3+s*3.1+7.)*.27+n1(x*5.1+s*1.7+13.)*.11; }
void main(){
  vec2 uv=gl_FragCoord.xy/uRes;
  float asp=uRes.x/uRes.y;
  float t=uTime*.01;
  vec2 sunp=vec2(.72,.5);
  float sd=length((uv-sunp)*vec2(asp,1.));
  vec3 sky=mix(uC1,uC0,pow(smoothstep(.25,1.05,uv.y),.75));
  vec3 sunc=mix(uC4,vec3(1.,.82,.58),.5);
  sky+=sunc*(exp(-sd*sd*4.5)*.34+exp(-sd*sd*80.)*.3);
  // clouds drifting slowly, rim-lit by the sun
  vec2 cp=vec2(uv.x*asp*1.2+t*4.,uv.y*5.2);
  float c=fbm(cp*vec2(.7,1.)+fbm3(cp*.5)*.8);
  float c2=fbm(cp*vec2(.7,1.)+fbm3(cp*.5)*.8+vec2(.05,.12));
  float cm=smoothstep(.42,.7,c)*smoothstep(.5,.62,uv.y)*(1.-smoothstep(.88,1.05,uv.y));
  float cl=clamp((c-c2)*6.+.5,0.,1.);
  vec3 cloudc=mix(mix(uC1,uC0,.35)*.95+.04,vec3(1.,.9,.78),cl*.6+exp(-sd*1.3)*.5);
  sky=mix(sky,cloudc,cm*.6);
  vec3 col=sky;
  float aa=1.5/uRes.y;
  for(int i=0;i<6;i++){
    float d=float(i)/5.;
    float base=mix(.55,.14,d*.85+d*d*.15);
    float amp=mix(.10,.22,d);
    float fr=mix(.55,1.05,d);
    float xx=uv.x*asp*fr+float(i)*3.7;
    float sd2=float(i)*2.3+1.;
    float h=(hillH(xx,sd2)-.5)*2.1;
    float y=base+h*amp;
    float h2=(hillH(xx+.02,sd2)-.5)*2.1;
    float slope=(h2-h)/.02*amp*fr/asp;      // dy/dx in screen units
    float m=smoothstep(y+aa,y-aa,uv.y);
    float into=clamp((y-uv.y)/(amp*1.6+.04),0.,1.);
    vec3 hc=mix(uC2,uC3,pow(d,.75));
    // crest catches the low sun on the slopes that face it, falling off with depth into the hill
    float facing=clamp(-slope*4.+.25+.35*(uv.x-sunp.x<0.?0.:1.)*0.,0.,1.);
    float rim=facing*exp(-into*3.2);
    vec3 valley=hc*vec3(.5,.68,.82);
    vec3 crest=mix(hc,uC4,.5);
    hc=mix(crest,valley,smoothstep(0.,1.,into));
    hc=mix(hc,uC4*1.02,rim*.6*(.4+.6*d));
    // soft mown-grass texture on the nearer hills (broad, not pixel-fine)
    float st2=fbm3(vec2(xx*3.5+float(i)*5.,uv.y*5.));
    hc*=1.+(st2-.5)*.22*d;
    // light pooling: warmer towards the sun
    hc+=sunc*.10*exp(-pow((uv.x-sunp.x)*asp*1.3,2.))*(1.-into)*(.3+.7*d);
    float haze=pow(1.-d,2.1)*.34;
    hc=mix(hc,mix(uC1,sky,.5)*1.02,haze);
    col=mix(col,hc,m);
  }
  float vig=1.-.22*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- ocean: horizon, glitter path, slow swells
  // C0 sky top, C1 sky horizon, C2 deep water, C3 shallow/swell light, C4 sun
  ocean: `
vec3 skyc(vec3 d){
  float h=clamp(d.y,0.,1.);
  vec3 c=mix(uC1,uC0,pow(h,.55));
  vec3 sd=normalize(vec3(.28,.15,1.));
  float s=max(dot(d,sd),0.);
  c+=uC4*(pow(s,18.)*.45+pow(s,420.)*3.2+pow(s,2200.)*6.);
  return c;
}
float wave(vec2 w, float t){
  float h=0.;
  h+=sin(w.x*.9+w.y*.45+t*.6)*.5;
  h+=sin(w.x*1.7-w.y*.8+t*.8+1.2)*.25;
  h+=(fbm3(w*.9+vec2(t*.2,-t*.15))-.5)*.8;
  h+=(vnoise(w*5.+vec2(-t*.5,t*.4))-.5)*.12;
  return h;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float asp=max(uRes.x/uRes.y,1.);
  float hz=.55;
  float t=uTime*.5;
  vec3 col;
  vec3 d=normalize(vec3((uv.x-.5)*asp*.9,uv.y-hz,1.));
  if(uv.y>=hz){
    col=skyc(d);
    // soft clouds near the horizon
    float c=fbm3(vec2(uv.x*asp*2.+t*.02,uv.y*9.));
    col=mix(col,uC1*1.06,smoothstep(.55,.85,c)*smoothstep(hz+.3,hz,uv.y)*.4);
  }else{
    float k=-1./min(d.y,-1e-3);
    vec3 pos=d*k;
    vec2 w=pos.xz*vec2(.55,.9)*1.0;
    float e=.04;
    float h=wave(w,t); float hx=wave(w+vec2(e,0.),t)-h; float hz2=wave(w+vec2(0.,e),t)-h;
    float amp=.22/(1.+k*.06);
    vec3 n=normalize(vec3(-hx/e*amp,1.,-hz2/e*amp));
    vec3 r=reflect(d,n); r.y=abs(r.y);
    vec3 refl=skyc(r);
    float fr=.04+.96*pow(1.-clamp(dot(-d,n),0.,1.),5.);
    vec3 water=mix(uC2,uC3,smoothstep(-.4,.5,h)*.6);
    water*=.7+.3*smoothstep(1.,12.,k);
    col=mix(water,refl,clamp(fr*1.1+.1,0.,1.));
    // distance haze into the horizon
    col=mix(col,uC1,smoothstep(8.,60.,k)*.55);
  }
  col+=uC1*exp(-pow((uv.y-hz)*45.,2.))*.12;
  float vig=1.-.25*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,

  // ---------------------------------------------------------------- glass-blobs: metaball glass on a gradient
  // C0/C1/C2 backdrop gradient, C3 glass tint, C4 highlight
  glass: `
vec3 backdrop(vec2 p, float t){
  vec2 q=p+.08*vec2(sin(t*.3+p.y*2.),cos(t*.27+p.x*2.));
  float a=dot(q,vec2(.7,.7))+.5;
  vec3 c=mix(uC0,uC1,smoothstep(.0,.6,a));
  c=mix(c,uC2,smoothstep(.55,1.2,a+.2*sin(q.x*3.+t*.2)));
  return c;
}
float field(vec2 p, float t){
  float f=0.;
  for(int i=0;i<6;i++){
    float fi=float(i);
    vec2 c=vec2(.42*sin(t*.15*(1.+.31*fi)+fi*2.1),.27*cos(t*.12*(1.+.27*fi)+fi*1.3));
    float r=.085+.06*hash11(fi+3.)+.012*sin(t*.3+fi);
    vec2 d=p-c;
    f+=r*r/(dot(d,d)+1e-4);
  }
  return f;
}
void main(){
  vec2 uv=gl_FragCoord.xy/uRes; vec2 p=aspectP(uv);
  float t=uTime;
  float e=.003;
  float f0=field(p,t), fx=field(p+vec2(e,0.),t), fy=field(p+vec2(0.,e),t);
  // dome height: 0 at the blob edge, rising to 1 inside
  float h0=1.-1./max(f0,1.), hx=1.-1./max(fx,1.), hy=1.-1./max(fy,1.);
  vec3 bg=backdrop(p,t);
  float m=smoothstep(.97,1.03,f0);
  vec2 g=vec2(hx-h0,hy-h0)/e;
  vec3 n=normalize(vec3(-g*.06,1.));
  vec3 refr=backdrop(p+n.xy*1.4+vec2(.015,.01),t);
  vec3 L=normalize(vec3(-.55,.65,.5));
  float spec=pow(max(dot(reflect(-L,n),vec3(0.,0.,1.)),0.),70.);
  float spec2=pow(max(dot(reflect(-vec3(.5,-.6,.6),n),vec3(0.,0.,1.)),0.),30.);
  float fres=pow(1.-n.z,1.6);
  vec3 glass=mix(refr,uC3,.14)*(.96+.08*h0);
  glass+=uC4*(spec*.85+spec2*.18+fres*.38);
  vec3 col=mix(bg,glass,m);
  // soft shadow just outside the blob, glow on the lit side
  col*=1.-.07*smoothstep(.35,.95,f0)*(1.-m);
  float vig=1.-.2*dot(uv-.5,uv-.5)*2.;
  gl_FragColor=vec4(finish(col,vig),1.);
}`,
};

export const shaderDefs: ShaderDef[] = [
  {id: 'liquid-dusk', name: 'Liquid dusk', program: 'liquid', dark: true, res: 0.6, t0: 11,
    colors: ['#150d2e', '#3a2273', '#d2557f', '#ff9d6b', '#ffd9c2'],
    fallback: 'radial-gradient(70% 60% at 78% 85%, #ff9d6b 0%, transparent 62%), radial-gradient(60% 70% at 18% 20%, #5b34a8 0%, transparent 60%), linear-gradient(150deg, #150d2e 0%, #3a2273 55%, #d2557f 130%)'},
  {id: 'liquid-ice', name: 'Liquid ice', program: 'liquid', dark: false, res: 0.6, t0: 31,
    colors: ['#dcecf5', '#a9d3ea', '#6fb4dd', '#e9f6fb', '#ffffff'],
    fallback: 'radial-gradient(60% 60% at 25% 20%, #ffffff 0%, transparent 60%), linear-gradient(150deg, #dcecf5 0%, #a9d3ea 55%, #6fb4dd 120%)'},
  {id: 'liquid-ink', name: 'Liquid ink', program: 'liquid', dark: true, res: 0.6, t0: 53,
    colors: ['#06070a', '#0d1730', '#1c3f8a', '#2d7be0', '#9fd3ff'],
    fallback: 'radial-gradient(60% 60% at 75% 80%, rgba(45,123,224,0.55) 0%, transparent 62%), linear-gradient(150deg, #06070a 0%, #0d1730 60%, #1c3f8a 130%)'},
  {id: 'aurora-night', name: 'Aurora night', program: 'aurora', dark: true, res: 0.7, t0: 4,
    colors: ['#03060f', '#0a2230', '#39e6a0', '#6a5cff', '#dfe9ff'],
    fallback: 'radial-gradient(80% 50% at 50% 70%, rgba(57,230,160,0.42) 0%, transparent 65%), radial-gradient(60% 40% at 70% 40%, rgba(106,92,255,0.3) 0%, transparent 65%), linear-gradient(180deg, #03060f 0%, #0a2230 100%)'},
  {id: 'silk-navy', name: 'Silk navy and gold', program: 'silk', dark: true, res: 0.7, t0: 6,
    colors: ['#04070f', '#0f1e45', '#3d5bb0', '#f0cf86'],
    fallback: 'linear-gradient(130deg, #04070f 0%, #0f1e45 40%, #3d5bb0 70%, #0f1e45 100%)'},
  {id: 'silk-rose', name: 'Silk rose', program: 'silk', dark: false, res: 0.7, t0: 19,
    colors: ['#a35a6c', '#e8a9b6', '#fbe0e0', '#ffffff'],
    fallback: 'linear-gradient(130deg, #a35a6c 0%, #e8a9b6 45%, #fbe0e0 75%, #e8a9b6 100%)'},
  {id: 'light-leak', name: 'Light leak', program: 'lightleak', dark: true, res: 0.6, t0: 2,
    colors: ['#0a0607', '#ff7a1a', '#ff2e4d', '#ffe3a0', '#d62a8c'],
    fallback: 'radial-gradient(60% 80% at 0% 40%, rgba(255,122,26,0.8) 0%, transparent 62%), radial-gradient(50% 40% at 15% 100%, rgba(255,46,77,0.6) 0%, transparent 65%), radial-gradient(40% 60% at 100% 10%, rgba(214,42,140,0.5) 0%, transparent 65%), #0a0607'},
  {id: 'caustics', name: 'Caustics', program: 'caustics', dark: false, res: 0.6, t0: 3,
    colors: ['#0d7fd0', '#27a4ee', '#7ed4ff', '#d8f5ff'],
    fallback: 'linear-gradient(180deg, #7ed4ff 0%, #27a4ee 55%, #0d7fd0 100%)'},
  {id: 'bokeh-dusk', name: 'Bokeh dusk', program: 'bokeh', dark: true, res: 0.6, t0: 7,
    colors: ['#1c1238', '#6b2a63', '#ff9a6b', '#ff6f9c', '#9a7cff'],
    fallback: 'radial-gradient(40% 45% at 25% 70%, rgba(255,154,107,0.3) 0%, transparent 62%), radial-gradient(35% 40% at 80% 30%, rgba(154,124,255,0.3) 0%, transparent 62%), linear-gradient(180deg, #1c1238 0%, #6b2a63 100%)'},
  {id: 'dusk-sky', name: 'Dusk sky', program: 'dusk', dark: true, res: 0.6, t0: 5,
    colors: ['#1a1d4a', '#6b5aa8', '#f2a584', '#ffb584', '#4d3d7a'],
    fallback: 'radial-gradient(60% 50% at 34% 80%, rgba(255,214,168,0.7) 0%, transparent 65%), linear-gradient(180deg, #1a1d4a 0%, #6b5aa8 50%, #f2a584 100%)'},
  {id: 'hills', name: 'Meadow hills', program: 'hills', dark: false, res: 0.75, t0: 0,
    colors: ['#4a64b4', '#f6bfa6', '#86b0cf', '#23844a', '#f4ec98'],
    fallback: 'linear-gradient(180deg, #6f9fd6 0%, #f6d9b0 52%, #9db9a0 56%, #5f9460 72%, #2f6b3c 100%)'},
  {id: 'ocean', name: 'Ocean', program: 'ocean', dark: true, res: 0.7, t0: 0,
    colors: ['#27406f', '#e9a98b', '#0d2a45', '#3f86a6', '#ffe1b4'],
    fallback: 'linear-gradient(180deg, #27406f 0%, #e9a98b 54%, #3f86a6 56%, #0d2a45 100%)'},
  {id: 'glass-blobs', name: 'Glass blobs', program: 'glass', dark: false, res: 0.7, t0: 8,
    colors: ['#ffd1c2', '#e2b8ff', '#a9c8ff', '#ffffff', '#ffffff'],
    fallback: 'linear-gradient(135deg, #ffd1c2 0%, #e2b8ff 55%, #a9c8ff 100%)'},
];

export const shaderById: Record<string, ShaderDef> = Object.fromEntries(shaderDefs.map((d) => [d.id, d]));

// ------------------------------------------------------------------ WebGL runtime (shared by BackgroundField and the preview tool)
const VERT = `attribute vec2 a; void main(){ gl_Position=vec4(a,0.,1.); }`;
export const hexToVec3 = (hex: string): [number, number, number] => {
  let h = (/#?([0-9a-f]{3}|[0-9a-f]{6})\b/i.exec(hex)?.[1]) ?? '000000';
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as [number, number, number];
};

type GL = WebGLRenderingContext;
export class ShaderRenderer {
  private gl: GL;
  private prog: WebGLProgram;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private def: ShaderDef;
  constructor(canvas: HTMLCanvasElement, def: ShaderDef) {
    this.def = def;
    const gl = (canvas.getContext('webgl', {preserveDrawingBuffer: true, antialias: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance'}) ??
      canvas.getContext('experimental-webgl', {preserveDrawingBuffer: true})) as GL | null;
    if (!gl) throw new Error('WebGL unavailable');
    this.gl = gl;
    const frag = PROGRAMS[def.program];
    if (!frag) throw new Error(`unknown shader program ${def.program}`);
    const mk = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`shader ${def.id}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, mk(gl.FRAGMENT_SHADER, HEADER + frag));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`link ${def.id}: ${gl.getProgramInfoLog(p)}`);
    this.prog = p;
    gl.useProgram(p);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(p, 'a');
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uRes', 'uTime', 'uC0', 'uC1', 'uC2', 'uC3', 'uC4']) this.loc[n] = gl.getUniformLocation(p, n);
    const cols = def.colors;
    for (let i = 0; i < 5; i++) gl.uniform3fv(this.loc['uC' + i], hexToVec3(cols[Math.min(i, cols.length - 1)]));
  }
  /** Draw one frame at `t` seconds into the canvas's current pixel size. */
  draw(t: number) {
    const gl = this.gl;
    const c = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, c.width, c.height);
    gl.uniform2f(this.loc.uRes, c.width, c.height);
    gl.uniform1f(this.loc.uTime, t + (this.def.t0 ?? 0));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  /** Nothing to free by hand: the canvas owns the context, and losing it would break a canvas that React reuses (StrictMode). */
  dispose() { /* no-op */ }
}
