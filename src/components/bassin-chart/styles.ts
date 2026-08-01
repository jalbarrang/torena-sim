const gridClassWithoutLPerSP =
  'grid grid-cols-[50px_50px_minmax(180px,1fr)_100px_100px_100px_100px] w-full';
const gridClassWithLPerSP =
  'grid grid-cols-[50px_50px_minmax(180px,1fr)_100px_100px_100px_100px_100px] w-full';

export function getBassinGridClass(showLPerSP: boolean): string {
  return showLPerSP ? gridClassWithLPerSP : gridClassWithoutLPerSP;
}
