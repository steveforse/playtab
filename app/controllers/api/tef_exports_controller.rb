require "tef2"

module Api
  class TefExportsController < ApplicationController
    MAX_REQUEST_BYTES = 3_000_000

    def create
      return render json: { error: "Score is too large (3 MB maximum)." }, status: :content_too_large if request.content_length.to_i > MAX_REQUEST_BYTES
      score = params[:score]
      unless score.is_a?(ActionController::Parameters)
        return render json: { error: "Score must be an object." }, status: :unprocessable_entity
      end

      document = score.to_unsafe_h
      ScoreDocument.validate!(document)
      result = Tef2::Exporter.export(document, version: params[:version].to_s)
      render json: {
        filename: "#{safe_title(document["title"])}.tef",
        content: [ result[:bytes] ].pack("m0"),
        warnings: result[:warnings],
        version: result[:version]
      }
    rescue ScoreDocument::Invalid, Tef2::Exporter::Invalid => e
      render json: { error: e.message }, status: :unprocessable_entity
    end

    private

    def safe_title(title)
      title.to_s.strip.gsub(/[^\p{Alnum}._-]+/u, "-").sub(/\A-+|-+\z/, "").presence || "playtab-score"
    end
  end
end
