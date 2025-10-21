Docker dependencies notes

This image installs:
- LibreOffice (libreoffice) for Office -> PDF conversions
- Poppler (poppler-utils) for pdf2image
- Ghostscript (ghostscript) used by Camelot
- Java runtime (default-jre) required by tabula-py
- OpenCV runtime libraries (libgl1, libglib2.0, libsm6, libxext6, libxrender1)
- tk (tkinter) for camelot plotting
- Chinese fonts (fonts-noto-cjk, fonts-wqy-zenhei)
- Python packages: pandas, openpyxl, pdf2image, camelot-py[cv], tabula-py, paddleocr (and paddlepaddle), opencv-python-headless

These are provided to support future implementations of real handlers. Current handlers return stub artifacts.
