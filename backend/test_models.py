import os
import urllib.request
import json
from dotenv import load_dotenv

load_dotenv()
api_key = os.environ.get('GEMINI_API_KEY')

try:
    url = f'https://generativelanguage.googleapis.com/v1beta/models?key={api_key}'
    req = urllib.request.Request(url)
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read())
        for model in data.get('models', []):
            methods = model.get('supportedGenerationMethods', [])
            if 'generateContent' in methods:
                print(model['name'])
except Exception as e:
    import traceback
    traceback.print_exc()
