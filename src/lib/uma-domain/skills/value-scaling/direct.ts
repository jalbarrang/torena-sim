import type { ValueScalingDescriptor } from './descriptor.types';

export const directValueScalingDescriptor: ValueScalingDescriptor = Object.freeze({
  usage: [1],
  name: 'Direct',
  simulatable: true,
  describe: () => null
});
