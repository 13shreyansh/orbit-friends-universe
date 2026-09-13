import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'

const vertex = `varying vec3 p; varying vec3 n; varying vec3 v; void main(){p=position;n=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);v=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}`
const surface = `precision highp float; varying vec3 p; varying vec3 n; varying vec3 v; uniform float time;
float hash(vec3 q){return fract(sin(dot(q,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 q){vec3 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){vec3 q=p*5.+vec3(time*.035,time*.025,0.);float f=noise(q)*.55+noise(q*2.1)*.3+noise(q*4.2)*.15;float streak=sin(p.y*28.+f*9.+time*.18)*.08;vec3 c=mix(vec3(.95,.22,.025),vec3(1.9,1.22,.42),smoothstep(.22,.8,f+streak));float rim=pow(1.-max(dot(n,v),0.),2.);gl_FragColor=vec4(c+rim*vec3(.7,.38,.09),1.);}`
const corona = `precision highp float; varying vec3 n; varying vec3 v; uniform float time; void main(){float rim=pow(1.-abs(dot(normalize(n),normalize(v))),2.5);gl_FragColor=vec4(1.4,.62,.13,rim*.23);}`
export function DemoSun(){
  const mesh=useRef<THREE.Mesh>(null)
  const uniforms=useMemo(()=>({time:{value:0}}),[])
  useFrame(({clock},delta)=>{uniforms.time.value=clock.elapsedTime;if(mesh.current)mesh.current.rotation.y+=delta*.025})
  return <group>
    <mesh ref={mesh}><sphereGeometry args={[.95,64,48]}/><shaderMaterial uniforms={uniforms} vertexShader={vertex} fragmentShader={surface} toneMapped={false}/></mesh>
    <mesh scale={1.22}><sphereGeometry args={[.95,48,32]}/><shaderMaterial uniforms={uniforms} vertexShader={vertex} fragmentShader={corona} transparent depthWrite={false} blending={THREE.AdditiveBlending} side={THREE.BackSide}/></mesh>
    <pointLight color="#ffd09b" intensity={7} distance={22} decay={1.4}/>
  </group>
}
