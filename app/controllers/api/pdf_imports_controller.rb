module Api
  class PdfImportsController < ApplicationController
    skip_before_action :verify_authenticity_token, only: :create

    def create
      response.headers["Cache-Control"] = "no-store"
      if request.content_length.to_i > 10_100_000
        return render json: { error: "PDF upload is too large (10 MB maximum)." }, status: :content_too_large
      end
      file = params[:file]
      unless file.is_a?(ActionDispatch::Http::UploadedFile) && File.extname(file.original_filename).downcase == ".pdf"
        return render json: { error: "Choose a .pdf file." }, status: :unprocessable_entity
      end
      bytes = file.read(10_000_001)
      if bytes.bytesize > 10_000_000
        return render json: { error: "PDF upload is too large (10 MB maximum)." }, status: :content_too_large
      end
      render json: PdfConverter.convert(bytes, filename: file.original_filename)
    rescue PdfConverter::Invalid => e
      render json: { error: e.message }, status: :unprocessable_entity
    rescue PdfConverter::Unavailable => e
      render json: { error: e.message }, status: :service_unavailable
    end
  end
end
