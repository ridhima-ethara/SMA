# secrets/  — credential mount

Put credential files here (mounted read-only into the container at `/secrets/`):

| File | For |
|---|---|
| `secrets/gdrive-sa.json` | Google Drive corpus ingestion (`GDRIVE_SERVICE_ACCOUNT_FILE`) |
| `secrets/gcp-sa.json` | **Vertex AI** (`GOOGLE_APPLICATION_CREDENTIALS`) — Gemini text (`LLM_PROVIDER=gemini`, default), Imagen images (`IMAGE_PROVIDER=google`), and Claude-on-Vertex (`LLM_PROVIDER=vertex`) |

## Google Drive key
Put the **Google Drive service-account key** at:

```
secrets/gdrive-sa.json
```

This folder is mounted **read-only** into the backend container at `/secrets/` (see
`docker-compose.yml`), and the app reads the key from `GDRIVE_SERVICE_ACCOUNT_FILE`
(default `/secrets/gdrive-sa.json`).

## How to get the key
1. Google Cloud Console → create (or pick) a **Service Account** → **Keys** → *Add key* → JSON.
2. Enable the **Google Drive API** for the project.
3. **Share the Drive folder** (`GDRIVE_FOLDER_ID`) with the service account's email
   (`…@….iam.gserviceaccount.com`) as **Viewer**.
4. Save the downloaded JSON as `secrets/gdrive-sa.json`.

Then pull the corpus at runtime:
```bash
curl -s -X POST localhost:8080/v1/kb/ingest-gdrive | python3 -m json.tool
```

## Vertex AI key (Gemini text + Imagen images)
Put the **Google Cloud service-account key** at:

```
secrets/gcp-sa.json
```

The app reads it from `GOOGLE_APPLICATION_CREDENTIALS` (default `/secrets/gcp-sa.json`) for
both Gemini text generation and Imagen image generation.

### How to get the key
1. Google Cloud Console → enable the **Vertex AI API** (`aiplatform.googleapis.com`).
2. **IAM & Admin → Service Accounts** → create (or pick) a service account.
3. Grant it the **`Vertex AI User`** role (`roles/aiplatform.user`).
4. **Keys** → *Add key* → JSON → download; save as `secrets/gcp-sa.json`.
5. Set `GCP_PROJECT=<your-project-id>` in `.env`, then restart the backend.
6. (Preview models) request access to Gemini 3.x / Imagen in **Vertex Model Garden** if prompted.

> **Never commit real keys.** This folder is in `.dockerignore`; keep `gdrive-sa.json` and
> `gcp-sa.json` out of version control (both are git-ignored).

## OpenAI image generation (`IMAGE_PROVIDER=openai`)

Image generation now defaults to the OpenAI Images API with **`gpt-image-2`**, which uses
`OPENAI_API_KEY` from `.env` rather than a file in this folder — nothing to place here.

The Vertex paths above (`IMAGE_PROVIDER=gemini` / `google`) still work and still rely on
`secrets/gcp-sa.json`; `gcp-sa.json` remains required for Gemini **text** generation regardless
of which image provider is selected.
