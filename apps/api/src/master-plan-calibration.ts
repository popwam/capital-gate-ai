export type PixelPoint = { x: number; y: number };
export type GeoPoint = { latitude: number; longitude: number };
export type CalibrationPoint = PixelPoint & GeoPoint;

/** Least-squares affine calibration. Three non-collinear points are the minimum. */
export function calibrateMasterPlan(points: CalibrationPoint[]) {
  if (points.length < 3) throw new Error("MASTER_PLAN_CALIBRATION_REQUIRES_3_POINTS");
  const solve = (target: (p: CalibrationPoint) => number) => {
    const a = points.map(p => [p.x, p.y, 1]);
    const ata = Array.from({ length: 3 }, (_, r) => Array.from({ length: 3 }, (_, c) => a.reduce((s,row)=>s+row[r]*row[c],0)));
    const atb = Array.from({ length: 3 }, (_, r) => a.reduce((s,row,i)=>s+row[r]*target(points[i]),0));
    const m = ata.map((row,i)=>[...row,atb[i]]);
    for (let i=0;i<3;i++) { let pivot=i; for(let r=i+1;r<3;r++) if(Math.abs(m[r][i])>Math.abs(m[pivot][i])) pivot=r; [m[i],m[pivot]]=[m[pivot],m[i]]; if(Math.abs(m[i][i])<1e-12) throw new Error("MASTER_PLAN_CALIBRATION_POINTS_COLLINEAR"); const d=m[i][i]; for(let c=i;c<4;c++) m[i][c]/=d; for(let r=0;r<3;r++) if(r!==i){const f=m[r][i]; for(let c=i;c<4;c++) m[r][c]-=f*m[i][c];}}
    return [m[0][3],m[1][3],m[2][3]] as const;
  };
  const lat = solve(p=>p.latitude), lng = solve(p=>p.longitude);
  return (pixel: PixelPoint): GeoPoint => ({ latitude: lat[0]*pixel.x+lat[1]*pixel.y+lat[2], longitude: lng[0]*pixel.x+lng[1]*pixel.y+lng[2] });
}
