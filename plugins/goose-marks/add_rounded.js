import sharp from 'sharp';

async function addRoundedCorner() {
  const size = 128;
  const radius = Math.floor(size * 0.22);

  const svg = `
    <svg width="${size}" height="${size}">
      <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
    </svg>
  `;

  await sharp('logo_副本.png')
    .composite([{
      input: Buffer.from(svg),
      blend: 'dest-in'
    }])
    .png()
    .toFile('logo_rounded.png');

  console.log(`✅ 已添加 ${radius}px 圆角`);
}

addRoundedCorner().catch(console.error);
