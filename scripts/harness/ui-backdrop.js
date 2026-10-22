// Stand-in for the 3D view so the translucency of the UI layer can be judged: a perspective corridor with neon.
// 'dark' is a moody club, 'bright' is a harshly lit white-wall room (the worst case for grey control boxes).
export function drawBackdrop(ctx, w, h, kind = 'dark') {
  const bright = kind === 'bright';
  const hz = h * 0.48;
  const sky = ctx.createLinearGradient(0, 0, 0, hz);
  sky.addColorStop(0, bright ? '#e8e6ee' : '#0a0612');
  sky.addColorStop(1, bright ? '#cfcad8' : '#1b1030');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, hz);
  const fl = ctx.createLinearGradient(0, hz, 0, h);
  fl.addColorStop(0, bright ? '#9a96a6' : '#150d24');
  fl.addColorStop(1, bright ? '#ece9f2' : '#2a1a48');
  ctx.fillStyle = fl;
  ctx.fillRect(0, hz, w, h - hz);
  // floor tiles in perspective
  ctx.strokeStyle = bright ? 'rgba(60,50,80,0.35)' : 'rgba(124,58,237,0.35)';
  ctx.lineWidth = 1;
  const cx = w / 2;
  for (let i = -8; i <= 8; i++) {
    ctx.beginPath();
    ctx.moveTo(cx + i * 14, hz);
    ctx.lineTo(cx + i * w * 0.32, h);
    ctx.stroke();
  }
  for (let j = 1; j < 9; j++) {
    const y = hz + (h - hz) * (j / 9) ** 2;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // far wall with a door, neon strips and speaker stacks
  const ww = w * 0.5;
  ctx.fillStyle = bright ? '#f4f2f8' : '#241238';
  ctx.fillRect(cx - ww / 2, hz - h * 0.2, ww, h * 0.2);
  ctx.fillStyle = bright ? '#bdb8c8' : '#08040f';
  ctx.fillRect(cx - ww * 0.12, hz - h * 0.15, ww * 0.24, h * 0.15);
  ctx.fillStyle = '#ff2e93';
  ctx.fillRect(cx - ww / 2, hz - h * 0.2, ww, 3);
  ctx.fillStyle = '#22d3ee';
  ctx.fillRect(cx - ww / 2, hz - 3, ww, 3);
  for (const s of [-1, 1]) {
    ctx.fillStyle = bright ? '#d8d4e2' : '#120a1e';
    ctx.fillRect(cx + s * ww * 0.36 - 20, hz - h * 0.17, 40, h * 0.17);
    ctx.strokeStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(cx + s * ww * 0.36, hz - h * 0.07, 12, 0, Math.PI * 2);
    ctx.stroke();
  }
  // side walls
  ctx.fillStyle = bright ? '#dcd8e6' : '#1a0d2c';
  ctx.beginPath();
  ctx.moveTo(0, 0); ctx.lineTo(cx - ww / 2, hz - h * 0.2); ctx.lineTo(cx - ww / 2, hz); ctx.lineTo(0, h); ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(w, 0); ctx.lineTo(cx + ww / 2, hz - h * 0.2); ctx.lineTo(cx + ww / 2, hz); ctx.lineTo(w, h); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#ff2e93';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, h * 0.12); ctx.lineTo(cx - ww / 2, hz - h * 0.14);
  ctx.moveTo(w, h * 0.12); ctx.lineTo(cx + ww / 2, hz - h * 0.14);
  ctx.stroke();
  // a robot silhouette in the middle, so the crosshair has something to sit on
  ctx.fillStyle = bright ? '#7a1020' : '#5a0e1c';
  ctx.fillRect(cx - 22, hz - 70, 44, 90);
  ctx.fillStyle = '#ff6a2a';
  ctx.fillRect(cx - 14, hz - 56, 10, 6);
  ctx.fillRect(cx + 4, hz - 56, 10, 6);
}
