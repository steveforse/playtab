class Song < ApplicationRecord
  validates :title, presence: true, length: { maximum: 160 }
  validates :source_text, length: { maximum: 100_000 }, allow_nil: true
  validate :valid_score

  private

  def valid_score
    ScoreDocument.validate!(score)
  rescue ScoreDocument::Invalid => e
    errors.add(:score, e.message)
  end
end
