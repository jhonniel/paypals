"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Float, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";

function ReceiptMesh() {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!group.current) return;
    group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.32) * 0.22;
    group.current.rotation.x = Math.cos(state.clock.elapsedTime * 0.26) * 0.07;
    group.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.06;
  });

  return (
    <Float speed={1.2} rotationIntensity={0.18} floatIntensity={0.45}>
      <group ref={group} position={[0.35, 0.05, 0]} scale={1.08}>
        <RoundedBox args={[1.7, 2.35, 0.07]} radius={0.05} smoothness={4}>
          <meshStandardMaterial color="#f2f6f4" roughness={0.42} metalness={0.04} />
        </RoundedBox>
        <mesh position={[0, 0.88, 0.045]}>
          <planeGeometry args={[0.85, 0.09]} />
          <meshBasicMaterial color="#0d7a62" />
        </mesh>
        {[0.58, 0.34, 0.1, -0.14, -0.38, -0.62].map((y, i) => (
          <mesh key={y} position={[-0.08, y, 0.045]}>
            <planeGeometry args={[i % 2 === 0 ? 1.15 : 0.95, 0.055]} />
            <meshBasicMaterial color="#c8d4ce" />
          </mesh>
        ))}
        <mesh position={[0.28, -0.92, 0.045]}>
          <planeGeometry args={[0.78, 0.12]} />
          <meshBasicMaterial color="#2ee6a6" />
        </mesh>
        {/* Soft ground disc for depth */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.35, 0]}>
          <circleGeometry args={[1.1, 48]} />
          <meshBasicMaterial color="#0d7a62" transparent opacity={0.08} />
        </mesh>
      </group>
    </Float>
  );
}

function SoftParticles({ count = 56 }: { count?: number }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = (Math.random() - 0.35) * 7;
      arr[i * 3 + 1] = (Math.random() - 0.5) * 4.5;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 3.2;
    }
    return arr;
  }, [count]);

  useFrame((state) => {
    if (!points.current) return;
    points.current.rotation.y = state.clock.elapsedTime * 0.035;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.032} color="#2ee6a6" transparent opacity={0.4} />
    </points>
  );
}

export function HeroScene() {
  return (
    <div className="absolute inset-0 -z-0">
      <Canvas
        camera={{ position: [0.6, 0.1, 4.4], fov: 40 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 6, 3]} intensity={1.15} color="#ffffff" />
        <directionalLight position={[-4, -1, -2]} intensity={0.4} color="#2ee6a6" />
        <ReceiptMesh />
        <SoftParticles />
      </Canvas>
    </div>
  );
}
