# College Result Portal

The repository has two independent deployable applications:

- `frontend/`: Vite-built static site for Vercel.
- `backend/`: Express API and Supabase scripts for Render. Supabase migrations and Edge Functions are under `backend/supabase/`.

## Local Development

Install and run each application from its own directory:

```bash
cd frontend
npm install
npm run dev
```

```bash
cd backend
npm install
cp .env.example .env
npm start
```

Set real Supabase credentials, including `SUPABASE_SERVICE_ROLE_KEY`, a strong `ADMIN_PASSWORD`, a long random `JWT_SECRET`, and the deployed frontend origin in `backend/.env`. Keep the service-role key on the backend only; never expose it to the frontend.

## Deployment

For Vercel, set the project root to `frontend`. The build command is `npm run build`, and the output directory is `dist`.

For Render, create a Node web service with root directory `backend` and start command `npm start`. Set `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`, `JWT_SECRET`, and `FRONTEND_URL` in the Render environment. Render provides `PORT` automatically. The service-role key is used only by protected backend admin deletion operations and must not be added to frontend configuration.

The frontend calls `https://collegeresult.onrender.com` by default through `window.API_BASE_URL` in `frontend/public/js/api-config.js`. Set `window.API_BASE_URL` before loading that script if the Render service uses another URL. The backend must allow the deployed Vercel origin through `FRONTEND_URL`.

Do not commit `.env` files or put Supabase service-role keys in the frontend.

