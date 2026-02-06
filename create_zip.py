import os
import zipfile

def zip_project(output_filename):
    exclude_dirs = {'node_modules', '__pycache__', '.git', '.venv', 'venv', 'dist', '.idea', '.vscode'}
    exclude_extensions = {'.pyc'}
    
    # Large files to optionally exclude if you want a really small zip
    # exclude_files = {'sam2_hiera_large.pt', 'yolov8m.pt'} 
    exclude_files = set() # keeping them for now as they are needed for it to run out of box

    with zipfile.ZipFile(output_filename, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, dirs, files in os.walk('.'):
            # Modify dirs in-place to skip excluded directories
            dirs[:] = [d for d in dirs if d not in exclude_dirs]
            
            for file in files:
                if file in exclude_files or os.path.splitext(file)[1] in exclude_extensions:
                    continue
                
                # prevent zipping the zip itself or the script
                if file == output_filename or file == 'create_zip.py':
                    continue

                file_path = os.path.join(root, file)
                print(f"Adding {file_path}")
                zipf.write(file_path, arcname=os.path.relpath(file_path, '.'))

if __name__ == "__main__":
    print("Creating portable zip...")
    zip_project('YOLO_SAM2_Project.zip')
    print("Done! Created YOLO_SAM2_Project.zip")
