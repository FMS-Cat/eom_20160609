#define MARCH_ITER 100
#define RAYAMP_MIN 0.01
#define INIT_LEN 0.01
#define NSAMPLE 1
#define NREF 10
#define SKY_COLOR vec3(0.02)

#define IFS_ROTATE vec3( 0.38,  - cos( time * PI ) * PI, 0.17 )
#define IFS_SHIFT vec3( 2.0, 1.9, 1.8 )
#define IFS_ITER 4

// ---

#define PI 3.14159265
#define V vec2(0.,1.)
#define saturate(i) clamp(i,0.,1.)

// ---

precision highp float;

uniform float time;
uniform vec2 resolution;

uniform vec3 u_cameraPos;

uniform sampler2D textureRandom;

// ---

vec3 color;
vec3 amp;

// ---

vec4 seed;
float preRandom() {
  const vec4 q = vec4(   1225.0,    1585.0,    2457.0,    2098.0);
  const vec4 r = vec4(   1112.0,     367.0,      92.0,     265.0);
  const vec4 a = vec4(   3423.0,    2646.0,    1707.0,    1999.0);
  const vec4 m = vec4(4194287.0, 4194277.0, 4194191.0, 4194167.0);

  vec4 beta = floor(seed / q);
  vec4 p = a * (seed - beta * q) - beta * r;
  beta = (sign(-p) + vec4(1.0)) * vec4(0.5) * m;
  seed = (p + beta);

  return fract(dot(seed / m, vec4(1.0, -1.0, 1.0, -1.0)));
}

vec4 random() {
  return vec4(
    preRandom(),
    preRandom(),
    preRandom(),
    preRandom()
  );
}

// ---

mat2 rotate2D( float _t ) {
  return mat2( cos( _t ), sin( _t ), -sin( _t ), cos( _t ) );
}

vec3 rotateEuler( vec3 _p, vec3 _r ) {
  vec3 p = _p;
  p.yz = rotate2D( _r.x ) * p.yz;
  p.zx = rotate2D( _r.y ) * p.zx;
  p.xy = rotate2D( _r.z ) * p.xy;
  return p;
}

float smin( float _a, float _b, float _k ) {
  float h = clamp( 0.5 + 0.5 * ( _b - _a ) / _k, 0.0, 1.0 );
  return mix( _b, _a, h ) - _k * h * ( 1.0 - h );
}

// ---

struct Camera {
  vec3 pos;
  vec3 dir;
  vec3 sid;
  vec3 top;
};

struct Ray {
  vec3 dir;
  vec3 ori;
  bool inside;
};

struct Material {
  vec3 color;
  vec3 emissive;

  float reflective;
  float reflectiveRoughness;
  float refractive;
  float refractiveIndex;
};

struct Map {
  float dist;
  Material material;
};

struct March {
  Ray ray;
  Map map;
  float len;
  vec3 pos;
};

// ---

Camera camInit( in vec3 _pos, in vec3 _tar ) {
  Camera cam;
  cam.pos = _pos;
  cam.dir = normalize( _tar - _pos );
  cam.sid = normalize( cross( cam.dir, V.xyx ) );
  cam.top = normalize( cross( cam.sid, cam.dir ) );

  return cam;
}

Map distFunc( in vec3 _p );
Ray rayInit( in vec3 _ori, in vec3 _dir ) {
  Ray ray;
  ray.dir = _dir;
  ray.ori = _ori;
  ray.inside = distFunc( ray.ori ).dist < 0.0;
  return ray;
}

Ray rayFromCam( in vec2 _p, in Camera _cam ) {
  vec3 dir = normalize( _p.x * _cam.sid + _p.y * _cam.top + _cam.dir );
  return rayInit( _cam.pos, dir );
}

Material mtlInit( in vec3 _col ) {
  Material material;
  material.color = _col;
  material.emissive = V.xxx;
  material.reflective = 0.0;
  material.reflectiveRoughness = 0.0;
  material.refractive = 0.0;
  material.refractiveIndex = 1.0;
  return material;
}

Map mapInit( in float _dist ) {
  Map map;
  map.dist = _dist;
  map.material = mtlInit( V.xxx );
  return map;
}

March marchInit( in Ray _ray ) {
  March march;
  march.ray = _ray;
  march.len = INIT_LEN;
  march.pos = _ray.ori + _ray.dir * march.len;
  return march;
}

// ---

float box( in vec3 _pos, in vec3 _size ) {
  vec3 d = abs( _pos ) - _size;
  return min( max( d.x, max( d.y, d.z ) ), 0.0 ) + length( max( d, 0.0 ) );
}

float metaball( in vec3 _p, in float _time ) {
  vec3 p = _p;
  float dist = 1E9;

  for ( int i = 0; i < 6; i ++ ) {
    vec3 translate = vec3(
      sin( 3.0 + _time * mod( float( i + 3 ) * 3.0, 4.0 ) * PI * 2.0 ),
      sin( 1.0 + _time * mod( float( i + 1 ) * 3.0, 5.0 ) * PI * 2.0 ),
      sin( 5.0 + _time * mod( float( i + 1 ) * 4.0, 3.0 ) * PI * 2.0 )
    ) * 0.7;
    p = rotateEuler( _p, vec3( float( i ) * 1.4 ) );
    p = p - translate;
    dist = smin( dist, length( p ) - 0.7, 0.3 );
  }

  return dist;
}

vec3 ifs( in vec3 _p, in vec3 _rot, in vec3 _shift, in int _iter ) {
  vec3 p = _p;

  // p = rotateEuler( p, -_rot );

  for ( int i = 0; i < 20; i ++ ) {
    if ( _iter <= i ) { break; }

    float intensity = pow( 2.0, -float( i ) );

    p = rotateEuler( p, _rot );

    p = abs( p ) - _shift * intensity;

    if ( p.x < p.y ) { p.xy = p.yx; }
		if ( p.x < p.z ) { p.xz = p.zx; }
		if ( p.y < p.z ) { p.yz = p.zy; }
  }

  return p;
}

Map distFunc( in vec3 _p, in float _time ) {
  Map map = mapInit( 1E9 );

  vec3 p = _p;

  float metaDist = 0.0;
  {
    p = _p;
    float dist = metaball( p, _time );

    if ( dist < map.dist ) {
      map = mapInit( dist );
      map.material = mtlInit( vec3( 1.0, 1.0, 1.0 ) );
      map.material.emissive = vec3( 0.4, 0.9, 0.7 ) * 3.0;
      map.material.reflective = 1.0;
    }

    metaDist = dist;
  }

  {
    p = _p;
    p = ifs(
      p,
      IFS_ROTATE,
      IFS_SHIFT,
      IFS_ITER
    );
    float dist = box( p, vec3( 1.0, 0.05, 0.05 ) );
    dist = max( dist, -( length( _p - u_cameraPos ) - 0.3 ) );
    dist = max( dist, -( metaDist - 0.2 ) );

    if ( dist < map.dist ) {
      map = mapInit( dist );
      map.material = mtlInit( vec3( 0.5 ) );
      map.material.reflective = 1.0;
      map.material.reflectiveRoughness = 0.1;
    }
  }

  return map;
}

Map distFunc( in vec3 _p ) {
  return distFunc( _p, time );
}

vec3 normalFunc( in vec3 _p, in float _d ) {
  vec2 d = V * _d;
  return normalize( vec3(
    distFunc( _p + d.yxx ).dist - distFunc( _p - d.yxx ).dist,
    distFunc( _p + d.xyx ).dist - distFunc( _p - d.xyx ).dist,
    distFunc( _p + d.xxy ).dist - distFunc( _p - d.xxy ).dist
  ) );
}

// ---

March march( in Ray _ray ) {
  Ray ray = _ray;
  March march = marchInit( ray );

  for ( int iMarch = 0; iMarch < MARCH_ITER; iMarch ++ ) {
    Map map = distFunc( march.pos );
    map.dist *= ( ray.inside ? -1.0 : 1.0 ) * 0.8;

    march.map = map;
    march.len += map.dist;
    march.pos = ray.ori + ray.dir * march.len;

    if ( 1E3 < march.len || abs( map.dist ) < INIT_LEN * 0.01 ) { break; }
  }

  return march;
}

// ---

vec3 backgroundColor( in vec3 _dir ) {
  return V.xxx;
}

// ---

vec3 randomHemisphere( in vec3 _normal ) {
  vec3 dir = V.xxx;
  for ( int i = 0; i < 9; i ++ ) {
    dir = random().xyz * 2.0 - 1.0;
    if ( length( dir ) < 1.0 ) { break; }
  }
  dir = normalize( dir );
  if ( dot( dir, _normal ) < 0.0 ) { dir = -dir; }
  return dir;
}

Ray shade( in March _march ) {
  March march = _march;

  if ( abs( march.map.dist ) < 1E-2 ) {
    bool inside = march.ray.inside;
    vec3 normal = normalFunc( march.pos, 1E-4 );
    normal = inside ? -normal : normal;
    Material material = march.map.material;

    vec3 dir = V.xxx;
    float dice = random().x;

    color += amp * dot( normal, -march.ray.dir ) * march.map.material.emissive;
    amp *= march.map.material.color;

    if ( dice < material.reflective ) { // reflect
      vec3 ref = normalize( reflect(
        march.ray.dir,
        normal
      ) );
      vec3 dif = randomHemisphere( normal );
      dir = mix(
        ref,
        dif,
        material.reflectiveRoughness
      );

    } else if ( dice < material.reflective + material.refractive ) { // refract
      vec3 inc = normalize( march.ray.dir );
      bool toAir = ( 0.0 < dot( normal, inc ) );
      float eta = 1.0 / march.map.material.refractiveIndex;
      eta = inside ? 1.0 / eta : eta;

      dir = refract(
        inc,
        toAir ? -normal : normal,
        toAir ? 1.0 / eta : eta
      );
      dir = ( dir == V.xxx )
      ? ( normalize( reflect(
        march.ray.dir,
        normal
      ) ) )
      : normalize( dir );
      inside = !inside;

    } else { // diffuse
      dir = randomHemisphere( normal );
      amp *= max( dot( dir, normal ), 0.0 );
    }

    Ray ray = rayInit( march.pos, dir );
    ray.inside = inside;
    return ray;
  } else {
    color += amp * SKY_COLOR;
    amp *= 0.0;

    return rayInit( V.xxx, V.xxx );
  }
}

// ---

void main() {
  seed = texture2D( textureRandom, gl_FragCoord.xy / resolution );

  vec3 sum = V.xxx;

  for ( int iSample = 0; iSample < NSAMPLE; iSample ++ ) {
    vec3 camPos = u_cameraPos;
    camPos += ( random().xyz - 0.5 ) * 0.01;
    Camera cam = camInit(
      camPos,
      vec3( 0.0, 0.0, 0.0 )
    );
    vec2 pix = gl_FragCoord.xy + random().xy - 0.5;
    vec2 p = ( pix * 2.0 - resolution ) / resolution.x;
    Ray ray = rayFromCam( p, cam );

    color = V.xxx;
    amp = V.yyy;

    for ( int iRef = 0; iRef < NREF; iRef ++ ) {
      ray = shade( march( ray ) );

      if ( length( amp ) < RAYAMP_MIN ) { break; }
    }

    sum += color / float( NSAMPLE );
  }

  gl_FragColor = vec4( sum, 1.0 );
}
