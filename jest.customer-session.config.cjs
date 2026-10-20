module.exports = {
  rootDir: __dirname,

  testEnvironment: 'node',

  extensionsToTreatAsEsm: ['.ts'],

  testMatch: [
    '<rootDir>/apps/auth-service/src/customer-session.integration.spec.ts',
  ],

  moduleFileExtensions: ['ts', 'js', 'json'],

  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          rootDir: '.',
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
          skipLibCheck: true,
        },
      },
    ],
  },

  modulePathIgnorePatterns: [
    '<rootDir>/rimflex-backups/',
    '<rootDir>/dist/',
  ],

  watchPathIgnorePatterns: [
    '<rootDir>/rimflex-backups/',
    '<rootDir>/dist/',
  ],

  testPathIgnorePatterns: [
    '<rootDir>/rimflex-backups/',
    '<rootDir>/dist/',
  ],

  maxWorkers: 1,
};
