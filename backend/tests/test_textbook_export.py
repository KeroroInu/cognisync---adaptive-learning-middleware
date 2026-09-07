import csv
import io
from uuid import UUID

import pytest

from app.models.sql.message import ChatMessage, MessageRole
from app.services.textbook_library import retrieve_textbook


@pytest.mark.asyncio
async def test_textbook_evidence_roundtrips_through_both_csv_exports(test_db, admin_client, registered_user):
    sources = list(retrieve_textbook("movement"))
    async with test_db() as db:
        db.add(ChatMessage(user_id=UUID(registered_user["user_id"]), role=MessageRole.ASSISTANT, text="先补这一处 TODO。",
                           analysis={"scaffoldContext": {"learnerSupport": {
                               "contextVersion": "learner-support-v2-textbook", "templateDensity": "guided", "textbookSources": sources}}}))
        await db.commit()
    for path in ("/api/admin/export/csv/conversations", f'/api/admin/export/csv/user/{registered_user["user_id"]}'):
        response = await admin_client.get(path)
        assert response.status_code == 200, response.text
        rows = list(csv.DictReader(io.StringIO(response.text.lstrip("\ufeff"))))
        assert rows[0]["learner_support_version"] == "learner-support-v2-textbook"
        assert rows[0]["template_density"] == "guided"
        assert sources[0]["corpusHash"] in rows[0]["textbook_sources"]
        assert sources[0]["pages"] in rows[0]["textbook_sources"]
