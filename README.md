# Camera Style Filter

Real-time webcam style transformer project.

The project is configured as a Node.js app using Express. The intended start
file is `server.js`.

## Requirements

- Node.js 18 or newer
- npm

## Install Dependencies

Run this command in the project folder:

```powershell
npm install
```

This creates the `node_modules` folder automatically from `package.json`.

## Run The Project

Development mode:

```powershell
npm run dev
```

Normal start:

```powershell
npm start
```

## Current Scripts

```json
{
  "start": "node server.js",
  "dev": "node --watch server.js"
}
```

## Notes

- Do not edit `node_modules` manually.
- Do not commit `node_modules` to Git.
- If `npm start` fails with `Cannot find module 'server.js'`, create the
  `server.js` file first.
