export interface PRNG {
  int32: () => number;
  random: () => number;
  uniform: (upper: number) => number;
}
