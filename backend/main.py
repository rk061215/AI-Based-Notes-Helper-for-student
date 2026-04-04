from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from bson import ObjectId
from bson.errors import InvalidId
import google.generativeai as genai
import os
from dotenv import load_dotenv
from datetime import datetime, timezone
import io
import uuid
import pathlib

# ── Optional: PDF support ──
try:
    import fitz
    PDF_SUPPORT = True
except ImportError:
    PDF_SUPPORT = False
    print("WARNING: PyMuPDF not installed. PDF support disabled.")

# ── Optional: Image OCR support ──
try:
    from PIL import Image
    import pytesseract
    pytesseract.pytesseract.tesseract_cmd = r"C:\Program Files\Tesseract-OCR\tesseract.exe"
    OCR_SUPPORT = True
except ImportError:
    OCR_SUPPORT = False
    print("WARNING: pytesseract/Pillow not installed. Image OCR disabled.")

# ── MongoDB support ──
try:
    from pymongo import MongoClient
    MONGO_SUPPORT = True
except ImportError:
    MONGO_SUPPORT = False
    print("WARNING: pymongo not installed. Run: pip install pymongo")

# ─────────────────────────────────────────────
#   STARTUP
# ─────────────────────────────────────────────

load_dotenv()

app = FastAPI(title="AI Notes Generator API")

# CORS — allow all origins for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Uploads folder: create if missing ──
UPLOADS_DIR = pathlib.Path(__file__).parent / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

# ── Serve uploaded files as static ──
# Access via: http://127.0.0.1:8000/uploads/<filename>
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# ── Configure Gemini ──
API_KEY = os.getenv("GEMINI_API_KEY")
if not API_KEY or API_KEY == "your_api_key_here":
    print("WARNING: Valid GEMINI_API_KEY not found in .env file.")
else:
    genai.configure(api_key=API_KEY)

# ── Configure MongoDB ──
notes_collection = None
if MONGO_SUPPORT:
    MONGO_URI = os.getenv("MONGO_URI")
    if MONGO_URI and MONGO_URI != "your_mongodb_connection_string_here":
        try:
            client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
            db = client["ai_notes_db"]
            notes_collection = db["notes"]
            print("✅ MongoDB connected successfully.")
        except Exception as e:
            print(f"WARNING: MongoDB connection failed: {e}")
    else:
        print("WARNING: MONGO_URI not configured. Notes saving disabled.")


# ─────────────────────────────────────────────
#   HELPER: Serialize MongoDB doc for JSON
# ─────────────────────────────────────────────

def serialize_note(doc: dict) -> dict:
    """Convert MongoDB _id ObjectId to a plain string 'id' field."""
    doc["id"] = str(doc["_id"])
    del doc["_id"]
    if isinstance(doc.get("created_at"), datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


# ─────────────────────────────────────────────
#   TEXT EXTRACTION FUNCTIONS
# ─────────────────────────────────────────────

def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extracts plain text from all pages of a PDF using PyMuPDF."""
    if not PDF_SUPPORT:
        raise HTTPException(status_code=501, detail="PDF support not available. Install pymupdf.")
    try:
        doc = fitz.open(stream=file_bytes, filetype="pdf")
        pages = [doc.load_page(i).get_text().strip() for i in range(len(doc))]
        text = "\n\n".join(p for p in pages if p)
        if not text:
            raise HTTPException(status_code=422, detail="Could not extract readable text from the PDF.")
        return text
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"PDF extraction failed: {str(e)}")


def extract_text_from_image(file_bytes: bytes) -> str:
    """Runs Tesseract OCR on an image. Converts to grayscale first."""
    if not OCR_SUPPORT:
        raise HTTPException(status_code=501, detail="Image OCR not available. Install pytesseract and Pillow.")
    try:
        image = Image.open(io.BytesIO(file_bytes)).convert("L")
        text = pytesseract.image_to_string(image).strip()
        if not text:
            raise HTTPException(status_code=422, detail="Could not detect text clearly. Try a higher quality image.")
        return text
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Image OCR failed: {str(e)}")


# ─────────────────────────────────────────────
#   AI FUNCTIONS
# ─────────────────────────────────────────────

def create_prompt(text: str, mode: str) -> str:
    """Build a structured prompt for Gemini based on the selected mode."""
    if mode == "daily":
        instruction = """You are an expert Daily Study Analyzer.
Analyze the following text and provide a concise summary of the daily study progress.
Your output MUST:
- Use short bullet points
- Be clearly sectioned (e.g. Topics Covered, Key Takeaways, Next Steps)
- Be easy to read in under 30 seconds
- Avoid formal or paragraph-style responses"""
    else:
        instruction = """You are an expert teacher.
Convert the following text into structured Exam-Ready Notes.
Your output MUST:
- Use short bullet points
- Be clearly sectioned (e.g. Core Concepts, Definitions, Important Formulas/Facts)
- Be easy to read in under 30 seconds
- Avoid formal or paragraph-style responses"""
    return f"{instruction}\n\nText to analyze:\n{text}\n"


def generate_notes(prompt: str) -> str:
    """Send prompt to Gemini and return the generated text."""
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        response = model.generate_content(prompt)
        return response.text
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gemini API Error: {str(e)}")


def generate_title(output_text: str) -> str:
    """Ask Gemini to produce a short 5-word title from the notes output."""
    try:
        model = genai.GenerativeModel('gemini-2.5-flash')
        prompt = f"Generate a very short title (5 words max) for these notes. Return only the title, no quotes:\n\n{output_text[:500]}"
        return model.generate_content(prompt).text.strip()
    except Exception:
        # Fallback: first non-empty line of the output
        first = next((l.strip() for l in output_text.splitlines() if l.strip()), "Untitled Note")
        return first[:60]


# ─────────────────────────────────────────────
#   ROUTE: Generate Notes
# ─────────────────────────────────────────────

@app.post("/summarize")
async def summarize(
    text: str = Form(default=""),
    mode: str = Form(default="exam"),
    file: UploadFile = File(default=None),
):
    """
    Accept text OR a file (PDF/image), extract text, call Gemini, return notes.
    Also saves the uploaded file to disk and returns its URL for later viewing.
    """
    if not os.getenv("GEMINI_API_KEY") or os.getenv("GEMINI_API_KEY") == "your_api_key_here":
        raise HTTPException(status_code=500, detail="API Key not configured. Add GEMINI_API_KEY to .env file.")

    extracted_text = ""
    saved_file_url = None   # Will be set if a file is uploaded

    # ── Case 1: File uploaded ──
    if file and file.filename:
        file_bytes = await file.read()
        filename_lower = file.filename.lower()

        # Save file to uploads/ with a unique name to avoid collisions
        ext = pathlib.Path(file.filename).suffix.lower()
        unique_name = f"{uuid.uuid4().hex}{ext}"
        save_path = UPLOADS_DIR / unique_name
        save_path.write_bytes(file_bytes)
        saved_file_url = f"http://127.0.0.1:8000/uploads/{unique_name}"

        if filename_lower.endswith(".pdf"):
            extracted_text = extract_text_from_pdf(file_bytes)
        elif filename_lower.endswith((".png", ".jpg", ".jpeg")):
            extracted_text = extract_text_from_image(file_bytes)
        else:
            raise HTTPException(status_code=415, detail="Unsupported file type. Use PDF or image (.png/.jpg/.jpeg).")

    # ── Case 2: Plain text ──
    elif text and text.strip():
        extracted_text = text.strip()

    # ── Case 3: Nothing provided ──
    else:
        raise HTTPException(status_code=400, detail="Please provide text or upload a file.")

    prompt = create_prompt(extracted_text, mode)
    notes = generate_notes(prompt)

    return {
        "notes": notes,
        "input_text": extracted_text,
        "file_url": saved_file_url,   # null if no file was uploaded
    }


# ─────────────────────────────────────────────
#   ROUTE: Save Note
# ─────────────────────────────────────────────

class SaveNoteRequest(BaseModel):
    title: str = ""
    input_text: str
    output_text: str
    mode: str = "exam"
    file_url: str = ""   # optional — path to uploaded file

@app.post("/save")
async def save_note(req: SaveNoteRequest):
    """Save a generated note to MongoDB. Auto-generates a title if not provided."""
    if notes_collection is None:
        raise HTTPException(status_code=503, detail="Database not connected. Add MONGO_URI to .env file.")
    if not req.input_text.strip() or not req.output_text.strip():
        raise HTTPException(status_code=400, detail="Input and output text cannot be empty.")

    title = req.title.strip() if req.title.strip() else generate_title(req.output_text)

    doc = {
        "title": title,
        "input_text": req.input_text,
        "output_text": req.output_text,
        "mode": req.mode,
        "file_url": req.file_url or None,   # stored as None if not present
        "created_at": datetime.now(timezone.utc),
    }

    result = notes_collection.insert_one(doc)
    return {"message": "Note saved successfully!", "id": str(result.inserted_id), "title": title}


# ─────────────────────────────────────────────
#   ROUTE: Get All Notes
# ─────────────────────────────────────────────

@app.get("/notes")
async def get_notes():
    """Fetch all saved notes sorted newest-first."""
    if notes_collection is None:
        raise HTTPException(status_code=503, detail="Database not connected.")
    docs = list(notes_collection.find().sort("created_at", -1))
    return [serialize_note(doc) for doc in docs]


# ─────────────────────────────────────────────
#   ROUTE: Get Single Note
# ─────────────────────────────────────────────

@app.get("/note/{note_id}")
async def get_note(note_id: str):
    """Fetch a single note by its MongoDB ObjectId string."""
    if notes_collection is None:
        raise HTTPException(status_code=503, detail="Database not connected.")
    try:
        doc = notes_collection.find_one({"_id": ObjectId(note_id)})
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid note ID format.")
    if not doc:
        raise HTTPException(status_code=404, detail="Note not found.")
    return serialize_note(doc)


# ─────────────────────────────────────────────
#   ROUTE: Delete Note
# ─────────────────────────────────────────────

@app.delete("/note/{note_id}")
async def delete_note(note_id: str):
    """Delete a note by its MongoDB ObjectId string."""
    if notes_collection is None:
        raise HTTPException(status_code=503, detail="Database not connected.")
    try:
        result = notes_collection.delete_one({"_id": ObjectId(note_id)})
    except InvalidId:
        raise HTTPException(status_code=400, detail="Invalid note ID format.")
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Note not found.")
    return {"message": "Note deleted successfully."}


# ─────────────────────────────────────────────
#   ROUTE: Search Notes
# ─────────────────────────────────────────────

@app.get("/search")
async def search_notes(q: str = ""):
    """Case-insensitive search across title and input_text."""
    if notes_collection is None:
        raise HTTPException(status_code=503, detail="Database not connected.")
    if not q.strip():
        return []
    query = {"$or": [
        {"title":      {"$regex": q, "$options": "i"}},
        {"input_text": {"$regex": q, "$options": "i"}},
    ]}
    docs = list(notes_collection.find(query).sort("created_at", -1))
    return [serialize_note(doc) for doc in docs]


# ─────────────────────────────────────────────
#   SERVE FRONTEND
#   IMPORTANT: This mount MUST be last — it's a
#   catch-all and will intercept any route above it
#   if placed earlier in the file.
# ─────────────────────────────────────────────
FRONTEND_DIR = pathlib.Path(__file__).parent.parent / "frontend"
app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
