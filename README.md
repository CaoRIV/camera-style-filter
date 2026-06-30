# CameraRealtimeStyle

CameraRealtimeStyle is a real-time webcam style transformer. It uses
MediaPipe hand tracking in the browser to switch styles with gestures, and a
local Express server to safely proxy fal.ai realtime styling requests without
exposing the API key to the client.

## Features

- Live webcam preview in the browser
- Gesture controls with MediaPipe hand landmarks
- Point right to switch to the next style
- Point left to switch to the previous style
- Open hand to return to the normal camera feed
- Keyboard fallback with left and right arrow keys
- Realtime style generation through `fal-ai/flux-2/klein/realtime`
- Local server-side fal.ai proxy and short-lived token endpoint
- Adjustable endpoint, output size, steps, feedback, and send FPS

## Tech Stack

- Node.js
- Express
- Vanilla HTML, CSS, and JavaScript modules
- MediaPipe Tasks Vision
- fal.ai realtime client

## Requirements

- Node.js 18 or newer
- npm
- A fal.ai API key
- A browser with webcam permission enabled

## Setup

Install dependencies:

```powershell
npm install
```

Create a local environment file:

```powershell
Copy-Item .env.example .env
```

Open `.env` and replace the placeholder value with your real fal.ai key:

```env
FAL_KEY=your-key-id:your-key-secret
```

You can create or manage keys from the fal.ai dashboard:

```text
https://fal.ai/dashboard/keys
```

## Run Locally

Start the development server:

```powershell
npm run dev
```

Or start normally:

```powershell
npm start
```

Then open:

```text
http://localhost:3000
```

If you set a custom port in `.env`, use that port instead:

```env
PORT=3000
```

## How To Use

1. Open the app in the browser.
2. Click `Start Camera`.
3. Allow camera permission.
4. Use hand gestures to control the style:
   - Point right: next style
   - Point left: previous style
   - Open hand: normal camera feed
5. Use the left and right arrow keys if gestures are not detected.

Frames are only sent to fal.ai while a generated style is active. The normal
camera feed does not call the model.

## Project Structure

```text
.
|-- public/
|   |-- app.js        # Main browser app and camera loop
|   |-- filters.js    # One Euro smoothing filter for hand tracking
|   |-- gestures.js   # Hand gesture detection
|   |-- index.html    # App markup
|   |-- styler.js     # fal.ai realtime styling client
|   `-- styles.css    # App styling
|-- .env.example      # Example environment variables
|-- .gitignore
|-- package.json
|-- package-lock.json
|-- README.md
`-- server.js         # Express static server and fal.ai proxy
```

## Available Scripts

```powershell
npm run dev
```

Runs the server with Node.js watch mode.

```powershell
npm start
```

Runs the server normally.

## Environment Variables

| Name | Required | Description |
| --- | --- | --- |
| `FAL_KEY` | Yes | fal.ai API key used only by the local server |
| `PORT` | No | Local server port. Defaults to `3000` |

## Notes

- Do not commit `.env`.
- Do not commit `node_modules`.
- Install dependencies from `package.json` with `npm install`.
- The browser uses CDN-hosted MediaPipe and fal.ai client modules, so internet
  access is required while running the app.
- Styling will fail if `FAL_KEY` is missing, but the page can still load.

## Troubleshooting

### `FAL_KEY is not set`

Create `.env` from `.env.example` and add your real fal.ai API key.

### Browser camera does not start

Check that the browser has camera permission and that no other app is using the
camera.

### `npm install` fails because `package.json` is missing

Run the command from the project root:

```powershell
cd D:\cameraStyleFilter
npm install
```

### Styled output is slow

Try lowering `Send FPS`, using `square` output size, or reducing `Steps` in the
settings panel.

## License

MIT
