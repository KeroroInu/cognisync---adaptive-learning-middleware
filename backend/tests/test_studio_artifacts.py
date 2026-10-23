import base64
import io
import json
import zipfile
import zlib
from urllib.parse import quote
from uuid import uuid4

import pytest
from app.services.drawio import diagram_models, diagram_text
from app.services.work_records import readme_preview
from test_classroom import classroom_actors as classroom_actors, start
from test_sfls_materials import publish, unpack, work_archive

XML = '<mxGraphModel><root><mxCell id="a" value="移动"/><mxCell id="b" value="计分"/><mxCell edge="1" source="a" target="b"/></root></mxGraphModel>'

def test_drawio_validation_and_plain_text():
    assert '移动 → 计分' in diagram_text(XML)
    compressor = zlib.compressobj(wbits=-15)
    encoded = base64.b64encode(compressor.compress(quote(XML).encode()) + compressor.flush()).decode()
    assert '移动 → 计分' in diagram_text(f'<mxfile><diagram>{encoded}</diagram></mxfile>')
    for invalid in ['<!DOCTYPE x [<!ENTITY evil "x">]><mxGraphModel/>', '<html/>', '<mxfile/>', '<mxfile><diagram>broken</diagram></mxfile>']:
        with pytest.raises(ValueError):
            diagram_models(invalid)

def test_readme_bounded_projection():
    def archive(value):
        data = io.BytesIO()
        with zipfile.ZipFile(data, 'w') as z:
            z.writestr('project/README.md', value)
        return data.getvalue()
    assert readme_preview(archive('# 我的作品'))['text'] == '# 我的作品'
    assert readme_preview(archive('x' * 65537))['text'] is None
    assert readme_preview(archive(b'\xff'))['text'] is None

@pytest.mark.asyncio
async def test_personal_design_download_and_readme_preview(client, classroom_actors):
    a = classroom_actors
    session = (await start(client, a))['id']
    material = await publish(client, a, session)
    base = f'/api/materials/{material["id"]}'
    assert (await client.get(base+'/readme', headers=a['first'])).json()['data'] is None
    body = {'request_id': str(uuid4()), 'base_revision': 0, 'requirements': '我的想法', 'drawio_xml': XML}
    saved = await client.post(base+'/design', headers=a['first'], json=body)
    assert saved.status_code == 200, saved.text
    assert (await client.post(base+'/design', headers=a['first'], json=body)).json() == saved.json()
    design = unpack(await client.get(base+'/design/download', headers=a['first']))
    assert design['design/current/architecture.drawio'].decode() == XML
    assert '移动 → 计分' in design['design/current/architecture.md'].decode()
    assert (await client.get(base+'/design/download', headers=a['second'])).status_code == 404
    assert (await client.get(base+'/readme', headers=a['other'])).status_code == 404
    task = json.loads(unpack(await client.post(base+'/download', headers=a['first']))['sfls-task.json'])
    original = '# 我的作品\n<script>不会执行</script>'
    submitted = await client.post(base+f'/submit?request_id={uuid4()}', headers=a['first'], content=work_archive(task, readme=original))
    assert submitted.status_code == 200, submitted.text
    response = await client.get(base+'/readme', headers=a['first'])
    assert response.headers['cache-control'] == 'no-store'
    assert response.json()['data']['text'] == original
    assert (await client.get(base+'/readme', headers=a['second'])).json()['data'] is None
