"""Add owner/title index to books table

Revision ID: b7c3e1f9a2d4
Revises: 0246901434a1
Create Date: 2025-08-04 10:12:44.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b7c3e1f9a2d4'
down_revision = '0246901434a1'
branch_labels = None
depends_on = None


def upgrade():
    # Composite index backing the default library listing
    # (owner-scoped, ordered by case-insensitive title).
    op.create_index(
        'ix_books_owner_lower_title',
        'books',
        ['owner_id', sa.text('lower(title)')],
        unique=False,
    )


def downgrade():
    op.drop_index('ix_books_owner_lower_title', table_name='books')
