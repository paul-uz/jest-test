module.exports = {
  coverageReporters: ['clover', 'text'],
  preset: 'ts-jest',
  reporters: [ 'default' ],
  testEnvironment: 'node',
  transform: {'^.+\\.tsx?$': 'ts-jest'}, // fixes the issue of changing preset
};
