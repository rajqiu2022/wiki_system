import sys
sys.path.insert(0, "F:/Code/wiki-system/backend")
log_file = "F:/Code/wiki-system/backend/test_output.txt"
with open(log_file, "w", encoding="utf-8") as f:
    try:
        import pydantic
        f.write(f"pydantic: {pydantic.__version__}\n")
        import multipart
        f.write(f"multipart: ok\n")
        from app.main import app
        f.write("OK - Import successful\n")
    except Exception as e:
        import traceback
        f.write("ERROR:\n")
        traceback.print_exc(file=f)
