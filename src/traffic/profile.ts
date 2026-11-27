// Visual traffic profiles: plausible family defaults, not certified aircraft performance.
export interface TrafficProfile {
  family: "light" | "regional" | "narrow" | "heavy";
  vr: number;
  rotation: number;
  pitchRate: number;
  rollRate: number;
  wingLoad: number;
  wheelbase: number;
  taxi: number;
  brake: number;
  idle: number;
  takeoff: number;
}
export function profileOf(type: string, len: number): TrafficProfile {
  if (/^(C1|C2|PA|BE[235]|SR2|DA[24]|PC12|TBM)/.test(type) || len < 14)
    return {
      family: "light",
      vr: 30,
      rotation: 7,
      pitchRate: 5,
      rollRate: 15,
      wingLoad: 800,
      wheelbase: 3,
      taxi: 5,
      brake: 1.3,
      idle: 20,
      takeoff: 95,
    };
  if (/^(CRJ|E1|E2|DH8|AT[47]|SF34)/.test(type) || len < 30)
    return {
      family: "regional",
      vr: 57,
      rotation: 8,
      pitchRate: 4,
      rollRate: 10,
      wingLoad: 3600,
      wheelbase: 12,
      taxi: 7,
      brake: 1.8,
      idle: 23,
      takeoff: 92,
    };
  if (len > 50)
    return {
      family: "heavy",
      vr: 80,
      rotation: 10,
      pitchRate: 2.5,
      rollRate: 5,
      wingLoad: 6500,
      wheelbase: 25,
      taxi: 6,
      brake: 1.6,
      idle: 25,
      takeoff: 94,
    };
  return {
    family: "narrow",
    vr: 74,
    rotation: 9,
    pitchRate: 4,
    rollRate: 7,
    wingLoad: 5500,
    wheelbase: 13,
    taxi: 8,
    brake: 2,
    idle: 24,
    takeoff: 92,
  };
}
