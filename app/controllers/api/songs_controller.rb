module Api
  class SongsController < ApplicationController
    MAX_SCORE_REQUEST_BYTES = 3_000_000

    def index
      render json: Song.order(created_at: :desc).limit(100).select(:id, :title, :created_at)
    end

    def show
      render json: Song.find(params[:id]).as_json(only: [ :id, :title, :score, :source_text ])
    end

    def create
      if request.content_length.to_i > MAX_SCORE_REQUEST_BYTES
        return render json: { error: "Score is too large (3 MB maximum)." }, status: :content_too_large
      end
      unless params[:score].is_a?(ActionController::Parameters)
        return render json: { error: "Score must be an object." }, status: :unprocessable_entity
      end
      document = params[:score].to_unsafe_h
      song = Song.new(title: document["title"], score: document, source_text: params[:source_text])
      if song.save
        render json: { id: song.id, title: song.title }, status: :created
      else
        render json: { error: song.errors.full_messages.join(". ") }, status: :unprocessable_entity
      end
    end
  end
end
