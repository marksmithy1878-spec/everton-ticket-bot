"""Build the local browser candidate without tests, credentials or user reports."""
from pathlib import Path
import json
import sys
import zipfile

root = Path(__file__).resolve().parent
source = root / "browser_probe"
version = json.loads((source / "manifest.json").read_text())["version"]
output = Path(sys.argv[1]) if len(sys.argv) > 1 else root.parent / f"Everton_Daytime_Pilot_v{version.replace('.', '_')}.zip"
runtime = ["manifest.json", "devtools.html", "devtools.js", "panel.html", "panel.css", "panel.js", "probe.js", "response_reader.js", "telegram_client.js", "alert_engine.js", "pilot_ui.js", "DAYTIME_PILOT.md", "README.md"]
with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
    for name in runtime:
        archive.write(source / name, "Everton_Passive_Check/" + name)
with zipfile.ZipFile(output) as archive:
    assert archive.testzip() is None
    assert json.loads(archive.read("Everton_Passive_Check/manifest.json"))["version"] == version
    assert len(archive.namelist()) == len(runtime)
print(f"Verified {output.name}: {len(runtime)} files, version {version}")
