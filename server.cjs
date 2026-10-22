// IIS launches this file directly, without npm, tsx or a TypeScript loader.
process.chdir(__dirname);
if (process.env.HTTP_PLATFORM_PORT) {
  process.env.PORT = process.env.HTTP_PLATFORM_PORT;
  process.env.HOST = '127.0.0.1';
}
import('./runtime/server/index.js').catch(error => {
  console.error('Shopwize startup failed:', error);
  process.exitCode = 1;
});
