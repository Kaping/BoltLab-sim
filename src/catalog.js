// 과학상자 6호 부품 카탈로그 (부품리스트 CSV 기준 수량)
// 파라메트릭 생성기로 커버되는 대표 부품 우선. 특수 부품은 추후 추가.

import {
  makeStrip, makeAngle, makeChannel, makeRectPlate,
  makeAxle, makeSpurGearS, makePinionGear, NARROW_W,
} from './generators.js';

export const CATALOG = [
  {
    group: '스트립',
    items: [
      { id: 'strip-25', label: '스트립-25', qty: 4, make: () => makeStrip(25) },
      { id: 'strip-15', label: '스트립-15', qty: 4, make: () => makeStrip(15) },
      { id: 'strip-11', label: '스트립-11', qty: 6, make: () => makeStrip(11) },
      { id: 'strip-9',  label: '스트립-9',  qty: 2, make: () => makeStrip(9) },
      { id: 'strip-5',  label: '스트립-5',  qty: 4, make: () => makeStrip(5) },
    ],
  },
  {
    group: '좁은스트립',
    items: [
      { id: 'nstrip-9', label: '좁은스트립-9', qty: 4, make: () => makeStrip(9, NARROW_W) },
      { id: 'nstrip-7', label: '좁은스트립-7', qty: 4, make: () => makeStrip(7, NARROW_W) },
      { id: 'nstrip-6', label: '좁은스트립-6', qty: 5, make: () => makeStrip(6, NARROW_W) },
      { id: 'nstrip-5', label: '좁은스트립-5', qty: 6, make: () => makeStrip(5, NARROW_W) },
      { id: 'nstrip-3', label: '좁은스트립-3', qty: 4, make: () => makeStrip(3, NARROW_W) },
    ],
  },
  {
    group: '앵글',
    items: [
      { id: 'angle-25', label: '앵글-25', qty: 4, make: () => makeAngle(25) },
      { id: 'angle-19', label: '앵글-19', qty: 4, make: () => makeAngle(19) },
      { id: 'angle-11', label: '앵글-11', qty: 2, make: () => makeAngle(11) },
      { id: 'angle-9',  label: '앵글-9',  qty: 2, make: () => makeAngle(9) },
      { id: 'angle-7',  label: '앵글-7',  qty: 2, make: () => makeAngle(7) },
      { id: 'angle-3',  label: '앵글-3',  qty: 2, make: () => makeAngle(3) },
    ],
  },
  {
    group: 'ㄷ형스트립',
    items: [
      { id: 'ch-7', label: 'ㄷ형스트립-7', qty: 2, make: () => makeChannel(7) },
      { id: 'ch-5', label: 'ㄷ형스트립-5', qty: 4, make: () => makeChannel(5) },
      { id: 'ch-3', label: 'ㄷ형스트립-3', qty: 4, make: () => makeChannel(3) },
    ],
  },
  {
    group: '평판',
    items: [
      { id: 'plate-3x5', label: '사각평판 3×5', qty: 2, make: () => makeRectPlate(5, 3) },
    ],
  },
  {
    group: '축',
    items: [
      { id: 'axle-290', label: '축 29cm',  qty: 2, make: () => makeAxle(290) },
      { id: 'axle-140', label: '축 14cm',  qty: 7, make: () => makeAxle(140) },
      { id: 'axle-100', label: '축 10cm',  qty: 3, make: () => makeAxle(100) },
      { id: 'axle-90',  label: '축 9cm',   qty: 2, make: () => makeAxle(90) },
      { id: 'axle-75',  label: '축 7.5cm', qty: 2, make: () => makeAxle(75) },
      { id: 'axle-65',  label: '축 6.5cm', qty: 2, make: () => makeAxle(65) },
      { id: 'axle-50',  label: '축 5cm',   qty: 2, make: () => makeAxle(50) },
      { id: 'axle-40',  label: '축 4cm',   qty: 1, make: () => makeAxle(40) },
    ],
  },
  {
    group: '기어',
    items: [
      { id: 'gear-spur-s', label: '평기어(소) 57T', qty: 2, make: () => makeSpurGearS() },
      { id: 'gear-pinion', label: '피니언기어 19T', qty: 3, make: () => makePinionGear() },
    ],
  },
];

export function findDef(defId) {
  for (const g of CATALOG) {
    const item = g.items.find(i => i.id === defId);
    if (item) return item;
  }
  return null;
}
