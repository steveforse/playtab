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
      return render_size_error if request_too_large?
      unless params[:score].is_a?(ActionController::Parameters)
        return render json: { error: "Score must be an object." }, status: :unprocessable_entity
      end
      song = build_song
      save_song(song, :created)
    end

    def update
      return render_size_error if request_too_large?
      song = Song.find(params[:id])
      unless params[:score].is_a?(ActionController::Parameters)
        return render json: { error: "Score must be an object." }, status: :unprocessable_entity
      end
      document = params[:score].to_unsafe_h
      song.assign_attributes(title: document["title"], score: document, source_text: params[:source_text])
      save_song(song, :ok)
    end

    private

    def request_too_large?
      request.content_length.to_i > MAX_SCORE_REQUEST_BYTES
    end

    def render_size_error
      render json: { error: "Score is too large (3 MB maximum)." }, status: :content_too_large
    end

    def build_song
      document = params[:score].to_unsafe_h
      Song.new(title: document["title"], score: document, source_text: params[:source_text])
    end

    def save_song(song, status)
      if song.save
        render json: { id: song.id, title: song.title }, status: status
      else
        render json: { error: song.errors.full_messages.join(". ") }, status: :unprocessable_entity
      end
    end
  end
end
