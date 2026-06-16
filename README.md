# DrRead

DrRead is a client-side single page app for reading academic PDFs with browser
text-to-speech and persistent notes.

## Features

- Drag-and-drop or click-to-upload PDF files.
- Client-side PDF text extraction with Mozilla PDF.js via CDN.
- Browser TTS playback with play, pause, stop, voice, rate, and pitch controls.
- Paragraph highlighting while reading aloud.
- Notes saved automatically in `localStorage`.

## Run

Run the local static server:

```bash
node server.js
```

Then open one of the URLs printed in the terminal.

- On this computer, use `http://127.0.0.1:4173/`.
- On a phone, connect to the same Wi-Fi and open the printed LAN URL, such as `http://192.168.1.23:4173/`.
- If Windows Firewall asks, allow Node.js on private networks.

Chrome, Edge, and Firefox provide the best support for PDF.js and the Web
Speech API. Mobile browser voices vary by operating system.

To use another port in PowerShell:

```powershell
$env:PORT=4174; node server.js
```

## Deploy to GitHub Pages

This project can run on GitHub Pages because it only uses static files and
browser APIs.

1. Push `index.html`, `styles.css`, `app.js`, `server.js`, `README.md`, and
   `.nojekyll` to a GitHub repository.
2. In GitHub, open `Settings` -> `Pages`.
3. Under `Build and deployment`, choose `Deploy from a branch`.
4. Select the branch, usually `main` or `master`, and the root folder `/`.
5. Save, then open the published URL shown by GitHub Pages.

On a phone, open the same GitHub Pages URL in the browser. Uploaded PDFs stay in
the phone browser and are not sent to GitHub.
