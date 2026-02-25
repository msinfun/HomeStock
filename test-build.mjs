import { build } from 'vite';

process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('UNHANDLED REJECTION:', reason);
    process.exit(1);
});

build().then(() => {
    console.log('Build successful');
}).catch((err) => {
    console.error('BUILD FAILED WITH ERROR:');
    console.error(err);
    process.exit(1);
});
