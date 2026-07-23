"""Extract Excel drawing anchors and build compact reference images for the UI."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
from zipfile import ZipFile
import xml.etree.ElementTree as ET

from PIL import Image


DRAWING_NS = {
    "xdr": "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    "rel": "http://schemas.openxmlformats.org/package/2006/relationships",
}


def _relation_map(archive):
    root = ET.fromstring(archive.read("xl/drawings/_rels/drawing1.xml.rels"))
    return {
        relation.attrib["Id"]: "xl/media/" + Path(relation.attrib["Target"]).name
        for relation in root.findall("rel:Relationship", DRAWING_NS)
    }


def _jpeg_bytes(raw):
    with Image.open(BytesIO(raw)) as image:
        if image.mode not in {"RGB", "L"}:
            background = Image.new("RGB", image.size, "white")
            if image.mode == "RGBA":
                background.paste(image, mask=image.getchannel("A"))
            else:
                background.paste(image.convert("RGB"))
            image = background
        else:
            image = image.convert("RGB")
        image.thumbnail((1200, 1200), Image.Resampling.LANCZOS)
        output = BytesIO()
        image.save(output, "JPEG", quality=72, optimize=True, progressive=True)
        return output.getvalue()


def extract_reference_assets(workbook_path, output_dir, public_prefix="/static/reference/"):
    """Return ``{excel_row: [reference...]}`` and write one compressed image per media file."""
    workbook_path = Path(workbook_path)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    references = {}

    with ZipFile(workbook_path) as archive:
        relations = _relation_map(archive)
        drawing = ET.fromstring(archive.read("xl/drawings/drawing1.xml"))
        image_counter = 0
        for anchor in list(drawing):
            origin = anchor.find("xdr:from", DRAWING_NS)
            blip = anchor.find(".//a:blip", DRAWING_NS)
            if origin is None or blip is None:
                continue
            relationship_id = blip.attrib.get("{%s}embed" % DRAWING_NS["r"])
            media_path = relations.get(relationship_id)
            if not media_path or media_path not in archive.namelist():
                continue
            row = int(origin.findtext("xdr:row", default="0", namespaces=DRAWING_NS)) + 1
            column = int(origin.findtext("xdr:col", default="0", namespaces=DRAWING_NS)) + 1
            image_name = Path(media_path).stem + ".jpg"
            target = output_dir / image_name
            if not target.exists():
                target.write_bytes(_jpeg_bytes(archive.read(media_path)))
            image_counter += 1
            label = "Excel参考图 %d" % image_counter
            if column == 8:
                label += "（原始状态）"
            elif column == 9:
                label += "（调试/维护后）"
            references.setdefault(row, []).append(
                {"name": image_name, "src": public_prefix + image_name, "label": label}
            )
    return references
