"""Generate checked-in browser assets. Run with Python and Pillow; not needed in CI."""
from pathlib import Path
from hashlib import sha256
import json
from PIL import Image

art = Path(__file__).resolve().parents[1] / 'game/public/art'
assets = []
for source in sorted(art.rglob('*.png')):
    target = source.with_suffix('.webp')
    with Image.open(source) as original:
        original.save(target, 'WEBP', quality=90, method=6, exact=True)
        with Image.open(target) as encoded:
            assert encoded.size == original.size
            assert encoded.convert('RGBA').getchannel('A').tobytes() == original.convert('RGBA').getchannel('A').tobytes()
        assets.append(dict(source=source.relative_to(art).as_posix(), runtime=target.relative_to(art).as_posix(),
                           width=original.width, height=original.height, sourceBytes=source.stat().st_size,
                           runtimeBytes=target.stat().st_size, sourceSha256=sha256(source.read_bytes()).hexdigest(),
                           runtimeSha256=sha256(target.read_bytes()).hexdigest()))
manifest = dict(format='WebP', quality=90, resized=False, alphaLossless=True, assets=assets)
(art / 'optimized-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
before, after = sum(a['sourceBytes'] for a in assets), sum(a['runtimeBytes'] for a in assets)
print(f'{len(assets)} assets: {before:,} -> {after:,} bytes ({100*(1-after/before):.1f}% smaller)')
