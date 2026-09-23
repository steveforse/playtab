module Api
  class TefImportsController < ApplicationController
    def create
      response.headers["Cache-Control"] = "no-store"
      if request.content_length.to_i > 110_000
        return render json: { error: "TEF upload is too large (100 KB maximum)." }, status: :content_too_large
      end
      file = params[:file]
      unless file.is_a?(ActionDispatch::Http::UploadedFile) && File.extname(file.original_filename).downcase == ".tef"
        return render json: { error: "Choose a .tef file." }, status: :unprocessable_entity
      end
      bytes = file.read(100_001)
      if bytes.bytesize > 100_000
        return render json: { error: "TEF upload is too large (100 KB maximum)." }, status: :content_too_large
      end
      if bytes.bytesize < 258
        return render json: { error: "This TEF file is incomplete or invalid." }, status: :unprocessable_entity
      end
      render json: TefConverter.convert(bytes)
    rescue TefConverter::Invalid => e
      render json: { error: e.message }, status: :unprocessable_entity
    rescue TefConverter::Unavailable => e
      render json: { error: e.message }, status: :service_unavailable
    end
  end
end
