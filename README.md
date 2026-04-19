# Reddit Bookmark Downloader

This Firefox add-on scans your browser's bookmarks to identify links to Reddit posts. It extracts the media files (images, videos, GIFs) from the identified links and downloads them all at once to your local drive.

## Installation and Debugging on Firefox

Follow the steps below to test the extension or run it from the source code:

1. Open the Firefox browser.
2. Type about:debugging in the address bar and press Enter.
3. Click on the This Firefox tab on the left menu.
4. Click the Load Temporary Add-on... button at the top of the page.
5. In the opened window, navigate to the project directory and select the manifest.json file.
6. The extension will be loaded into the browser, and its icon will appear in the extensions menu in the top right corner.
7. When you make changes to the code, you can apply the changes by clicking the Reload button located on the extension card on the about:debugging page.

*Note: Temporarily loaded extensions are removed when Firefox is closed. You need to repeat this process when you restart the browser.*
