// sw.js
const CACHE_NAME = 'corrupted-download-cache-v1';
// A real, sizable file to use as the source.
// Using a public test file. Replace with a local one if you're running a local server.
// For local, if index.html is at http://localhost:PORT/index.html,
// and you have a file ./test-files/large.zip, then actualFileUrl could be '/test-files/large.zip'
const actualFileUrl = 'https://images.pexels.com/photos/378570/pexels-photo-378570.jpeg?cs=srgb&dl=pexels-nout-gons-80280-378570.jpg&fm=jpg&_gl=1*1huw4i5*_ga*MTQwMjYyNTY2Mi4xNzUwNzA2Mjg3*_ga_8JE65Q40S6*czE3NTA3MDYyODYkbzEkZzAkdDE3NTA3MDYyODYkajYwJGwwJGgw'; // Public large test file

self.addEventListener('install', event => {
    console.log('SW: Install event');
    event.waitUntil(self.skipWaiting()); // Activate worker immediately
});

self.addEventListener('activate', event => {
    console.log('SW: Activate event');
    event.waitUntil(self.clients.claim()); // Become available to all pages
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Intercept specific path with a query param
    if (url.pathname === '/invoice.pdf' && url.searchParams.get('corrupt') === 'true') {
        console.log('SW: Intercepting download request for:', event.request.url);
        const filename = url.searchParams.get('filename') || 'corrupted_file.dat';
        event.respondWith(streamCorruptedFile(filename));
    }
   });

async function streamCorruptedFile(downloadFilename) {
    try {
        const response = await fetch(actualFileUrl); // Fetch the real file
	

        if (!response.ok || !response.body) {
            return new Response("SW: Could not fetch the source file.", { status: 500 });
        }

        let bytesStreamed = 0;
        // Interrupt after ~1MB of data for demonstration
        const interruptAfterBytes = 1 * 1024 * 1024; // 1MB

        const [stream1, stream2] = response.body.tee(); // Tee the stream so we can read it and pass it on

        const { readable, writable } = new TransformStream({
            transform(chunk, controller) {
                if (bytesStreamed + chunk.byteLength > interruptAfterBytes) {
                    const remainingBytes = interruptAfterBytes - bytesStreamed;
                    if (remainingBytes > 0) {
                        controller.enqueue(chunk.slice(0, remainingBytes));
                    }
                    bytesStreamed = interruptAfterBytes;
                    console.log(`SW: Interrupting stream after ${bytesStreamed} bytes.`);
                    // This is the key: signal an error in the stream
                    controller.error(new Error("Simulated network interruption by Service Worker."));
                    return; // Stop processing further chunks
                }
                controller.enqueue(chunk);
                bytesStreamed += chunk.byteLength;
            },
            flush(controller) {
                // This might be called if the source stream ends before interruption
                console.log('SW: Source stream flushed (ended naturally before interruption point).');
            }
        });

        // Pipe the original response body through our transform stream
        // Use stream1 for piping, and stream2 will be implicitly cancelled when stream1 is.
        stream1.pipeTo(writable).catch(err => {
            if (err.message.includes("Simulated network interruption")) {
                console.log("SW: Piping to transform stream aborted as expected.");
            } else {
                console.error("SW: Error piping to transform stream:", err);
            }
        });

        const responseHeaders = new Headers(response.headers);
        responseHeaders.set('Content-Disposition', `attachment; filename="${downloadFilename}"`);
        // Crucially, DO NOT set Content-Length, or if you do, it should be the *original*
        // file's length. The browser will then detect the stream ended prematurely.
        // Forcing an error in the stream is more reliable for showing "Failed".
        responseHeaders.delete('Content-Length');

        return new Response(readable, {
            headers: responseHeaders,
            status: 200 // Keep status 200, the error comes from the broken stream
        });

    } catch (error) {
        console.error('SW: Error in streamCorruptedFile:', error);
        return new Response(`SW: Service Worker failed: ${error.message}`, { status: 500 });
    }
}