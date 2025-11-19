# Streamcable

**Streamcable is still in alpha. The documentation is very limited, things might be broken, and the binary protocol might change.**

## Development

### Running Tests

This project uses [Vitest](https://vitest.dev/) for testing. The test suite includes comprehensive tests for:

- Basic schema types (string, uint, boolean, etc.)
- Complex schema types (object, array, union, etc.)
- Streaming functionality (promise, iterator, readableStream)
- Error handling (ValidationError, OutOfDataError, SerializableError)
- Integration tests for serialize/deserialize workflows

#### Available Test Commands

```bash
# Run all tests once
npm test

# Run tests in watch mode (re-runs on file changes)
npm run test:watch

# Run tests with UI
npm run test:ui

# Run tests with coverage report
npm run test:coverage
```

#### Test Coverage

The current test suite includes 100+ tests with approximately 60% code coverage. Coverage reports are generated in the `coverage/` directory when running `npm run test:coverage`.

### Building

```bash
npm run build
```

### Code Formatting

```bash
npm run format:fix
```
