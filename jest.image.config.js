/**
 * Image tests are kept out of `npm test`: they need Docker and a built image,
 * and they measure in seconds rather than milliseconds. `npm run test:image`
 * builds the image and runs them; CI points IMAGE_TAG at the image it built.
 */
const base = require("./jest.config");

/** @type {import('jest').Config} */
const config = {
  ...base,
  roots: ["<rootDir>/tests/image"],
  testPathIgnorePatterns: ["/node_modules/"],
  testTimeout: 120_000,
};

module.exports = config;
