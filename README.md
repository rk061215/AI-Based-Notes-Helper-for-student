# AI Notes Generator

A beautiful, minimal web application that converts any arbitrary text into structured, concise, exam-ready bullet points natively using the Google Gemini AI.

## Architecture & Tech Stack
- **Backend:** Python + FastAPI 
- **Frontend:** Pure HTML5, CSS3 (Modern Vanilla design constraints), Vanilla JavaScript
- **AI Integration:** Google Gemini API (`gemini-1.5-flash`)

## Project File Layout
```text
.
├── backend
│   ├── main.py              # FastAPI server logic and endpoints
│   └── requirements.txt     # Python dependencies 
├── frontend
│   ├── index.html           # Main UI template
│   ├── style.css            # Dynamic, premium dark-mode styling
│   └── script.js            # App logic & REST API bindings
├── .env                     # Sensitive environment variables for API
└── README.md                # Documentation (this file)
```

## How to Run locally

### 1. Configure your API key
Open the `.env` file and replace the placeholder text with your actual Google Gemini API key:
```env
GEMINI_API_KEY=your_actual_api_key_here
```

### 2. Start the Backend API
You will need Python 3.8+ installed on your system.

Navigate to the project directory in your terminal and install the dependencies:
```bash
pip install -r backend/requirements.txt
```

Launch the FastAPI backend server using Uvicorn:
```bash
uvicorn backend.main:app --reload
```
The server will now accept API requests at `http://127.0.0.1:8000`.

### 3. Start the Frontend Application
Since the frontend uses basic HTML and JavaScript, you can simply open the file in your browser:
- **Option 1**: Double click `frontend/index.html` to open it locally.
- **Option 2**: Run a quick local server for testing:
  ```bash
  cd frontend
  python -m http.server 3000
  ```
  Then head over to `http://localhost:3000` in your web browser.

## Features Built
1. **Dynamic Prompting:** App is strictly instructed to format notes without fluff, using headers and lists suitable for exam prep.
2. **Robust Error Handling:** Checks for empty states, missing API configurations or server errors.
3. **CORS Enabled:** API correctly accepts external requests ensuring your frontend isn't blocked by the browser. 
4. **Rich Markdown:** `marked.js` library natively parses the AI markdown output into beautiful, readable standard HTML on the fly.
5. **Modern Aesthetics:** Dark-gradient UI built exclusively with vanilla CSS featuring hover transformations, drop shadows, and glassmorphism.
