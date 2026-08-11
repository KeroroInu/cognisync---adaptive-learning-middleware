import pytest

from app.services.graph_service import GraphService


@pytest.mark.asyncio
async def test_get_graph_batches_optional_relationship_queries(monkeypatch):
    queries: list[tuple[str, dict]] = []

    async def fake_execute_query(query: str, params: dict):
        queries.append((query, params))
        if "INTERACTED_WITH]->(c:Concept)" in query:
            return [
                {
                    "id": "concept-python",
                    "name": "Python",
                    "description": "",
                    "category": "编程",
                    "mastery": 60,
                    "frequency": 2,
                    "isFlagged": False,
                }
            ]
        if "CO_OCCURRED_WITH" in query:
            return []
        return [
            {
                "source": "concept-python",
                "target": "concept-list",
                "relationship_type": "REL",
            },
            {
                "source": "concept-list",
                "target": "concept-loop",
                "relationship_type": "PREREQUISITE_OF",
            },
        ]

    monkeypatch.setattr(
        "app.services.graph_service.execute_query",
        fake_execute_query,
    )

    graph = await GraphService().get_graph("student-1")

    assert len(queries) == 3
    semantic_query, semantic_params = queries[-1]
    assert "MATCH (c1)-[r]->(c2)" in semantic_query
    assert "type(r) IN $relationship_types" in semantic_query
    assert ":REL" not in semantic_query
    assert ":PREREQUISITE_OF" not in semantic_query
    assert semantic_params["relationship_types"] == ["REL", "PREREQUISITE_OF"]
    assert [edge.relType for edge in graph.edges] == ["related", "prerequisite"]
