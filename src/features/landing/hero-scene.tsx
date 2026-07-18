"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function ReceiptMesh() {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.35) * 0.25;
    group.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.28) * 0.08;
  });

  return (
    <Float speed={1.4} rotationIntensity={0.25} floatIntensity={0.6}>
      <group ref={group} position={[0, 0.1, 0]}>
        <RoundedBox args={[1.6, 2.2, 0.06]} radius={0.06} smoothness={4}>
          <meshStandardMaterial color="#f4f7f5" roughness={0.35} metalness={0.05} />
        </RoundedBox>
        {[0.7, 0.45, 0.2, -0.05, -0.3, -0.55].map((y, i) => (
          <mesh key={y} position={[0, y, 0.04]}>
            <planeGeometry args={[i === 0 ? 1.0 : 1.2, 0.06]} />
            <meshBasicMaterial color={i === 0 ? "#0d7a62" : "#c5d0cb"} />
          </mesh>
        ))}
        <mesh position={[0.35, -0.85, 0.04]}>
          <planeGeometry args={[0.7, 0.1]} />
          <meshBasicMaterial color="#2ee6a6" />
        </mesh>
      </group>
    </Float>
  );
}

function SoftParticles({ count = 40 }: { count?: number }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 6;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 4;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 3;
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (!points.current) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.04;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#2ee6a6" transparent opacity={0.45} />
    </points>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 -z-0">
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[4, 6, 3]} intensity={1.1} color="#ffffff" />
        <directionalLight position={[-3, -2, -2]} intensity={0.35} color="#2ee6a6" />
        <ReceiptMesh />
        <SoftParticles />
      </Canvas>
    </div>
  );
}
