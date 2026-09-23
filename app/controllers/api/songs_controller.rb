module Api
  class SongsController < ApplicationController
    MAX_SCORE_REQUEST_BYTES = 3_000_000

    def index
      render json: current_user.songs.order(created_at: :desc).limit(100).select(:id, :title, :created_at)
    end

    def show
      song = current_user.songs.find(params[:id])
      render json: song.as_json(only: [ :id, :title, :score, :source_text ]).merge(revision: song.lock_version)
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
      song = current_user.songs.find(params[:id])
      return render_size_error if request_too_large?
      unless params[:revision].to_s.match?(/\A\d+\z/) && params[:revision].to_i == song.lock_version
        return render json: { error: "Changed in another tab. Reopen the score before saving." }, status: :conflict
      end
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
      current_user.songs.new(title: document["title"], score: document, source_text: params[:source_text])
    end

    def save_song(song, status)
      if song.save
        render json: { id: song.id, title: song.title, revision: song.lock_version }, status: status
      else
        render json: { error: song.errors.full_messages.join(". ") }, status: :unprocessable_entity
      end
    rescue ActiveRecord::StaleObjectError
      render json: { error: "Changed in another tab. Reopen the score before saving." }, status: :conflict
    end
  end
end
