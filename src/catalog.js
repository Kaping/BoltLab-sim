// 6호 부품 카탈로그 (부품 구성은 data/parts_list.csv 기준, 재고 수량 제한 없음)
// 파라메트릭 생성기로 커버되는 대표 부품 우선. 특수 부품은 추후 추가.

import {
  makeStrip, makeAngle, makeChannel, makeRectPlate, makeGridPlate, makeFlatPlateN, makePentagonPlate, makeTrianglePlate,
  makeAxle, makeSpurGearS, makeSpurGearL, makePinionGear, makeWormGear, makeWheelPlate8, makeGearedMotor,
  makeJoinPlate, makeLBracket, makeUBracket, makeMotor, makeSprocketS, makeSprocketL, makePulleyL, makePulleyM, makePulleyS, makeTirePulley, makeSlottedStrip, NARROW_W,
  makeSupportPlate, makeReverseAngleBracket, makeCornerBracket, makeSteeringBracket, makeBoxBearing,
  makeFlangePlateS, makeFlangePlateL, makeFlangePlate2x5, makeFlangePlate2x7, makeHalfDisc, makeWheelFlatPlate,
  makeCurvedStrip, makeDoubleCrank, makeFacePlateWheel, makeCrownGear, makeTwoStageGear,
} from './generators.js';

export const CATALOG = [
  {
    group: '스트립',
    items: [
      { id: 'strip-25', label: '스트립-25', make: () => makeStrip(25) },
      { id: 'strip-15', label: '스트립-15', make: () => makeStrip(15) },
      { id: 'strip-11', label: '스트립-11', make: () => makeStrip(11) },
      { id: 'strip-9',  label: '스트립-9',  make: () => makeStrip(9) },
      { id: 'strip-5',  label: '스트립-5',  make: () => makeStrip(5) },
      { id: 'sstrip-9', label: '장공스트립-9', make: () => makeSlottedStrip(9) },
      { id: 'sstrip-5', label: '장공스트립-5', make: () => makeSlottedStrip(5) },
      { id: 'curved-strip', label: '곡면스트립', make: () => makeCurvedStrip() },
    ],
  },
  {
    group: '좁은스트립',
    items: [
      { id: 'nstrip-9', label: '좁은스트립-9', make: () => makeStrip(9, NARROW_W) },
      { id: 'nstrip-7', label: '좁은스트립-7', make: () => makeStrip(7, NARROW_W) },
      { id: 'nstrip-6', label: '좁은스트립-6', make: () => makeStrip(6, NARROW_W) },
      { id: 'nstrip-5', label: '좁은스트립-5', make: () => makeStrip(5, NARROW_W) },
      { id: 'nstrip-3', label: '좁은스트립-3', make: () => makeStrip(3, NARROW_W) },
    ],
  },
  {
    group: '앵글',
    items: [
      { id: 'angle-25', label: '앵글-25', make: () => makeAngle(25) },
      { id: 'angle-19', label: '앵글-19', make: () => makeAngle(19) },
      { id: 'angle-11', label: '앵글-11', make: () => makeAngle(11) },
      { id: 'angle-9',  label: '앵글-9',  make: () => makeAngle(9) },
      { id: 'angle-7',  label: '앵글-7',  make: () => makeAngle(7) },
      { id: 'angle-3',  label: '앵글-3',  make: () => makeAngle(3) },
    ],
  },
  {
    group: 'ㄷ형스트립',
    items: [
      { id: 'ch-7', label: 'ㄷ형스트립-7', make: () => makeChannel(7) },
      { id: 'ch-5', label: 'ㄷ형스트립-5', make: () => makeChannel(5) },
      { id: 'ch-3', label: 'ㄷ형스트립-3', make: () => makeChannel(3) },
    ],
  },
  {
    group: '브래킷',
    items: [
      { id: 'join-plate',   label: '이음판',        make: () => makeJoinPlate() },
      { id: 'l-bracket-s',  label: 'ㄱ형브래킷(소)', make: () => makeLBracket(1) },
      { id: 'l-bracket-l',  label: 'ㄱ형브래킷(대)', make: () => makeLBracket(2) },
      { id: 'l-bracket-2x2', label: 'ㄱ형브래킷 2×2', make: () => makeLBracket(2, 2, 12.3) },
      { id: 'u-bracket-s',  label: 'ㄷ형브래킷(소)', make: () => makeUBracket() },
      { id: 'support-plate', label: '지지판', make: () => makeSupportPlate() },
      { id: 'rev-angle-bracket', label: '역각브래킷', make: () => makeReverseAngleBracket() },
      { id: 'corner-bracket-l', label: '모서리브래킷(좌)', make: () => makeCornerBracket(-1) },
      { id: 'corner-bracket-r', label: '모서리브래킷(우)', make: () => makeCornerBracket(1) },
      { id: 'steering-bracket', label: '조향브래킷', make: () => makeSteeringBracket() },
      { id: 'box-bearing', label: '상자형베어링', make: () => makeBoxBearing() },
    ],
  },
  {
    group: '평판',
    items: [
      { id: 'plate-flat-9', label: '평판-9', make: () => makeFlatPlateN(9) },
      { id: 'plate-flat-7', label: '평판-7', make: () => makeFlatPlateN(7) },
      { id: 'plate-flat-5', label: '평판-5', make: () => makeFlatPlateN(5) },
      { id: 'plate-flat-3', label: '평판-3', make: () => makeFlatPlateN(3) },
      { id: 'plate-l', label: '평판(대) 11×5', make: () => makeGridPlate(11, 5) },
      { id: 'plate-s', label: '평판(소) 3×3', make: () => makeGridPlate(3, 3) },
      { id: 'plate-3x5', label: '사각평판 3×5', make: () => makeRectPlate(5, 3) },
      { id: 'plate-tri-3x5', label: '삼각평판 3×5', make: () => makeTrianglePlate() },
      { id: 'plate-pentagon', label: '오각평판', make: () => makePentagonPlate() },
      { id: 'plate-half-disc', label: '반원판', make: () => makeHalfDisc() },
      { id: 'plate-wheel-flat', label: '바퀴평판', make: () => makeWheelFlatPlate() },
    ],
  },
  {
    group: '플랜지판',
    items: [
      { id: 'flange-s', label: '플랜지판(소) 5×3', make: () => makeFlangePlateS() },
      { id: 'flange-l', label: '플랜지판(대) 7×5', make: () => makeFlangePlateL() },
      { id: 'flange-2x5', label: '플랜지판 2×5', make: () => makeFlangePlate2x5() },
      { id: 'flange-2x7', label: '플랜지판 2×7', make: () => makeFlangePlate2x7() },
    ],
  },
  {
    group: '축',
    items: [
      { id: 'axle-290', label: '축 29cm',  make: () => makeAxle(294) },
      { id: 'axle-140', label: '축 14cm',  make: () => makeAxle(140) },
      { id: 'axle-100', label: '축 10cm',  make: () => makeAxle(102) },
      { id: 'axle-90',  label: '축 9cm',   make: () => makeAxle(90) },
      { id: 'axle-75',  label: '축 7.5cm', make: () => makeAxle(76) },
      { id: 'axle-65',  label: '축 6.5cm', make: () => makeAxle(65) },
      { id: 'axle-50',  label: '축 5cm',   make: () => makeAxle(51) },
      { id: 'axle-40',  label: '축 4cm',   make: () => makeAxle(40) },
    ],
  },
  {
    group: '기어',
    items: [
      { id: 'gear-spur-l', label: '평기어(대) 95T', make: () => makeSpurGearL() },
      { id: 'gear-spur-s', label: '평기어(소) 57T', make: () => makeSpurGearS() },
      { id: 'gear-pinion', label: '피니언기어 19T', make: () => makePinionGear() },
      { id: 'gear-two-stage', label: '2단평기어(소) 57T+19T', make: () => makeTwoStageGear() },
      { id: 'gear-crown', label: '크라운기어 50T', make: () => makeCrownGear() },
      { id: 'gear-worm', label: '워엄기어 Ø14', make: () => makeWormGear() },
      { id: 'sprocket-s', label: '체인기어(소) 12T', make: () => makeSprocketS() },
      { id: 'sprocket-l', label: '체인기어(대) 25T', make: () => makeSprocketL() },
    ],
  },
  {
    group: '풀리·바퀴 (T: 타이어)',
    items: [
      { id: 'pulley-l', label: '풀리(대) Ø76', make: () => makePulleyL() },
      { id: 'pulley-m', label: '풀리(중) Ø38', make: () => makePulleyM() },
      { id: 'pulley-s', label: '풀리(소) Ø25.5', make: () => makePulleyS() },
      { id: 'pulley-tire', label: '타이어풀리 Ø15.5', make: () => makeTirePulley() },
      { id: 'wheel-plate-8', label: '휠판-8 Ø36', make: () => makeWheelPlate8() },
      { id: 'wheel-face-plate', label: '면판휠 Ø63', make: () => makeFacePlateWheel() },
    ],
  },
  {
    group: '구동',
    items: [
      { id: 'motor', label: '모터뭉치', make: () => makeMotor() },
      { id: 'gearmotor', label: '기어드모터', make: () => makeGearedMotor() },
      { id: 'double-crank', label: '양팔크랭크', make: () => makeDoubleCrank() },
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
