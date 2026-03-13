async function run() {
    const pdfjs = await import('pdfjs-dist');
    console.log("pdfjs (dynamic): version is", pdfjs.version);
}
run();
