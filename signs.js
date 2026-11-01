import qrcode from './vendor/qrcode/qrcode.mjs';

export function makeQR(value) {
  const qr=qrcode(0,'M');
  qr.addData(value,'Byte');qr.make();
  return qr;
}
export function qrSVG(value) {
  return makeQR(value).createSvgTag({cellSize:5,margin:20,scalable:true});
}
