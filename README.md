# SharePad — setup aur deployment guide

## Step 1: Supabase project banao (free database)

1. https://supabase.com pe jaao, sign up karo (GitHub se ho sakta hai)
2. "New project" click karo, naam do (e.g. sharepad), password set karo, region select karo (Mumbai/Singapore rakho, India ke liye fastest)
3. Project ban jaane ke baad, left sidebar me "SQL Editor" pe jaao
4. Is repo ki `supabase_setup.sql` file ka pura content copy karo, paste karo, "Run" dabao — ye tumhari `pages` table bana dega
5. Left sidebar me "Project Settings" > "API" pe jaao
6. Wahan se "Project URL" aur "anon public" key copy kar lo — inhe agle step me use karenge

## Step 2: Local setup

1. Terminal me is folder ke andar jaao: `cd sharepad`
2. `npm install` chalao
3. `.env.example` file ko copy karke naam `.env` rakho: `cp .env.example .env`
4. `.env` file kholo aur apni Supabase URL aur anon key daal do
5. `npm run dev` chalao — ye local URL dega, browser me khol ke test karo

## Step 3: GitHub pe push karo

1. https://github.com pe naya repository banao (private rakh sakte ho)
2. Terminal me:
   ```
   git init
   git add .
   git commit -m "initial commit"
   git branch -M main
   git remote add origin YOUR_GITHUB_REPO_URL
   git push -u origin main
   ```

## Step 4: Vercel pe deploy karo (free hosting)

1. https://vercel.com pe jaao, GitHub se sign up karo
2. "Add New Project" > apna GitHub repo select karo
3. Framework "Vite" auto-detect ho jayega
4. "Environment Variables" section me ye do daalo (same jo `.env` me the):
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. "Deploy" dabao — 1-2 minute me live ho jayega

Deploy hone ke baad Vercel tumhe ek link dega jaise `sharepad-yourname.vercel.app` — ye real, live, HTTPS website hai jo koi bhi visit kar sakta hai.

## Security notes

- Random code generator already app me hai ("Generate a secure random page" button) — chhote guessable code ki jagah ye use karna better hai
- `supabase_setup.sql` me abhi policies sabko read/write allow karti hain (jaise Dontpad). Agar aage chal ke password/PIN layer chahiye, wo agla upgrade ho sakta hai
- Apna khud ka domain (jaise sharepad.com) chahiye to Vercel ke "Domains" section me add kar sakte ho (domain kharidna padega, ~Rs 700-1000/year GoDaddy ya Namecheap se)
